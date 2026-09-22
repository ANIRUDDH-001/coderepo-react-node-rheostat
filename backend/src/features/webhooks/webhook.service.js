import { randomBytes } from "node:crypto";
import { assertCan, can } from "../../shared/auth/permissions.js";
import { getConfig } from "../../shared/config/index.js";
import { AppError } from "../../shared/errors/app-error.js";
import { logger } from "../../shared/logging/logger.js";
import { auditService } from "../audit/audit.service.js";
import { projectService } from "../projects/project.service.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { createDispatcher } from "./dispatch.js";
import { createEvents, setDispatcher } from "./events.js";
import { deliveryRepository, receiptRepository, subscriptionRepository } from "./webhook.repository.js";

const NOT_FOUND = () => new AppError(404, "WEBHOOK_NOT_FOUND", "The requested webhook does not exist.");
const DELIVERY_NOT_FOUND = () => new AppError(404, "DELIVERY_NOT_FOUND", "The requested delivery does not exist.");
const newSecret = () => randomBytes(32).toString("hex");
const publicSubscription = ({ secret, ...rest }) => ({ ...rest, secretHint: `…${secret.slice(-4)}` });

// Real HTTP send. Any 2xx is success; the dispatcher measures duration and classifies errors.
export async function httpSend(url, body, headers) {
	const response = await fetch(url, { method: "POST", body, headers, signal: AbortSignal.timeout(5000), redirect: "manual" });
	const text = await response.text().catch(() => "");
	return { status: response.status, snippet: text.slice(0, 500) };
}

export function createWebhookService(deps) {
	const { subscriptions, deliveries, receipts, projects, audit, send = httpSend, apiOrigin, clock = () => performance.now(), log = logger } = deps;
	const dispatcher = createDispatcher({ deliveries, subscriptions, send, audit, log, clock });
	const events = createEvents({ subscriptions, deliveries, log, dispatchNow: () => dispatcher.dispatchDue(new Date()).catch((error) => log.warn("webhook.dispatch.failed", { error })) });
	const auditFor = (actor, action, subscription, summary, metadata = {}) =>
		audit.record({ actor, action, entityType: "webhook", entityId: subscription._id, entityLabel: subscription.name, projectId: subscription.projectId, summary, metadata });
	const canManage = (profile) => can(profile.role, "webhook:manage");
	const countsFor = async (filter) => {
		const rows = await deliveries.countByStatus(filter);
		const by = Object.fromEntries(rows.map((row) => [row._id, row.count]));
		return { delivered: by.delivered || 0, dead: by.dead || 0, pending: (by.pending || 0) + (by.delivering || 0), held: by.held || 0 };
	};
	async function load(id) {
		const subscription = await subscriptions.findById(id);
		if (!subscription) throw NOT_FOUND();
		return { subscription, project: await projects.getById(subscription.projectId) };
	}
	const decorateDelivery = async (delivery) => ({
		...delivery,
		subscription: await subscriptions.findById(delivery.subscriptionId).then((s) => (s ? publicSubscription(s) : null)),
		headers: { "X-Rheostat-Event": delivery.event, "X-Rheostat-Delivery": String(delivery._id), "X-Rheostat-Subscription": String(delivery.subscriptionId), "X-Rheostat-Signature": "t=<timestamp>,v1=<hmac-sha256>" },
	});

	const service = {
		__deps: deps,
		__withDeliveries: (override) => createWebhookService({ ...deps, deliveries: override }),
		dispatchDue: (now = new Date()) => dispatcher.dispatchDue(now),
		events,
		// `apiOrigin` may be a function so the default instance reads config lazily (module load precedes initConfig in tests).
		sinkUrlFor: (project) => `${typeof apiOrigin === "function" ? apiOrigin() : apiOrigin}/api/v1/webhook-sink/${project.webhookSink.token}`,

		async stats(projectId) {
			const [counts, count] = await Promise.all([countsFor({ projectId }), subscriptions.countByProject(projectId)]);
			return { deadDeliveries: counts.dead, subscriptions: count };
		},

		async list(project, profile) {
			assertCan(profile, "webhook:read");
			const rows = await subscriptions.findByProject(project._id);
			const items = await Promise.all(rows.map(async (row) => ({ ...publicSubscription(row), counts: await countsFor({ subscriptionId: row._id }) })));
			return { items, sinkUrl: service.sinkUrlFor(project), totals: { dead: (await countsFor({ projectId: project._id })).dead }, permissions: { canManage: canManage(profile) } };
		},

		async create(project, input, profile) {
			assertCan(profile, "webhook:manage");
			const secret = newSecret();
			const created = await subscriptions.create({ ...input, projectId: project._id, secret, createdBy: profile._id });
			await auditFor(profile, "webhook.created", created, `${profile.name} added webhook "${created.name}" (${created.events.length} events).`, { url: created.url, events: created.events });
			return { ...publicSubscription(created), secret, permissions: { canManage: true } };
		},

		async get(id, profile) {
			assertCan(profile, "webhook:read");
			const { subscription } = await load(id);
			return { ...publicSubscription(subscription), permissions: { canManage: canManage(profile) } };
		},

		async update(id, { rotateSecret = false, ...patch }, profile) {
			assertCan(profile, "webhook:manage");
			const { subscription } = await load(id);
			const wasEnabled = subscription.enabled;
			const now = new Date();
			const fields = { ...patch };
			if (patch.enabled === true) Object.assign(fields, { disabledReason: null, consecutiveFailures: 0 });
			if (patch.enabled === false) fields.disabledReason = "MANUAL";
			let secret;
			if (rotateSecret) fields.secret = secret = newSecret();
			const updated = await subscriptions.update(id, fields);
			if (patch.enabled === false && wasEnabled) await deliveries.holdPending(id);
			if (patch.enabled === true && !wasEnabled) await deliveries.releaseHeld(id, now);
			const changed = Object.keys(fields).filter((key) => key !== "secret");
			await auditFor(profile, rotateSecret ? "webhook.secretRotated" : "webhook.updated", updated, rotateSecret ? `${profile.name} rotated the secret of webhook "${updated.name}".` : `${profile.name} updated webhook "${updated.name}" (${changed.join(", ")}).`, { fields: changed });
			if (patch.enabled === true) dispatcher.dispatchDue(now).catch((error) => log.warn("webhook.dispatch.failed", { error }));
			return { ...publicSubscription(updated), ...(secret ? { secret } : {}), permissions: { canManage: true } };
		},

		async remove(id, profile) {
			assertCan(profile, "webhook:manage");
			const { subscription } = await load(id);
			await deliveries.removeForSubscription(id);
			await subscriptions.remove(id);
			await auditFor(profile, "webhook.deleted", subscription, `${profile.name} deleted webhook "${subscription.name}".`);
		},

		async deliveries(id, { status, cursor = null, limit = 25 }, profile) {
			assertCan(profile, "webhook:read");
			await load(id);
			const decoded = cursor ? decodeCursor(cursor) : null;
			if (cursor && !decoded) throw new AppError(400, "VALIDATION_ERROR", "The cursor is not valid.");
			const rows = await deliveries.findPage(id, { status, cursor: decoded, limit });
			const page = rows.slice(0, limit).map(({ payload, ...rest }) => ({ ...rest, lastAttempt: rest.attempts.at(-1) || null }));
			return { items: page, nextCursor: rows.length > limit ? encodeCursor(page.at(-1)) : null };
		},

		async getDelivery(deliveryId, profile) {
			assertCan(profile, "webhook:read");
			const delivery = await deliveries.findById(deliveryId);
			if (!delivery) throw DELIVERY_NOT_FOUND();
			return decorateDelivery(delivery);
		},

		// Fresh retry budget, full history kept, immediate attempt, and the same row returned.
		async redeliver(deliveryId, profile) {
			assertCan(profile, "webhook:manage");
			const delivery = await deliveries.findById(deliveryId);
			if (!delivery) throw DELIVERY_NOT_FOUND();
			if (delivery.status === "delivering" || delivery.status === "held") throw new AppError(422, "INVALID_TRANSITION", `A ${delivery.status} delivery cannot be requeued.`);
			const now = new Date();
			await deliveries.requeue(deliveryId, now, delivery.attempts.length);
			const subscription = await subscriptions.findById(delivery.subscriptionId);
			await auditFor(profile, "webhook.redelivered", subscription, `${profile.name} requeued delivery of ${delivery.event} to "${subscription.name}".`, { deliveryId: String(deliveryId) });
			await dispatcher.dispatchOne(deliveryId, now);
			return decorateDelivery(await deliveries.findById(deliveryId));
		},

		// Enqueues one webhook.test delivery for this subscription only, dispatches that row, returns that row.
		async test(id, profile) {
			assertCan(profile, "webhook:manage");
			const { subscription, project } = await load(id);
			if (!subscription.enabled) throw new AppError(422, "WEBHOOK_DISABLED", "Enable the webhook before sending a test.");
			const eventId = `test:${subscription._id}:${Date.now()}:${randomBytes(4).toString("hex")}`;
			const [created] = await events.enqueue({ event: "webhook.test", eventId, project, data: { subscriptionId: String(subscription._id), requestedBy: String(profile._id) }, onlySubscriptionId: subscription._id });
			await dispatcher.dispatchOne(created._id, new Date());
			return decorateDelivery(await deliveries.findById(created._id));
		},

		async receipts(project, profile) {
			assertCan(profile, "webhook:read");
			return receipts.findRecent(project._id);
		},
		async clearReceipts(project, profile) {
			assertCan(profile, "webhook:manage");
			await receipts.clear(project._id);
		},
	};
	return service;
}

export const webhookService = createWebhookService({
	subscriptions: subscriptionRepository,
	deliveries: deliveryRepository,
	receipts: receiptRepository,
	projects: { getById: (id) => projectService.getById(id) },
	audit: { record: (entry) => auditService.record(entry) },
	apiOrigin: () => getConfig().apiOrigin,
});
setDispatcher(() => webhookService.dispatchDue(new Date()));
