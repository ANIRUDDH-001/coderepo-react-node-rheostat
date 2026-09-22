import { randomBytes } from "node:crypto";
import { SYSTEM_ACTOR_ID } from "../../shared/auth/system-actor.js";
import { BACKOFF_MS } from "../../features/webhooks/dispatch.js";
import { sign } from "../../features/webhooks/signature.js";
import { WebhookDelivery } from "../../features/webhooks/webhook-delivery.model.js";
import { WebhookReceipt } from "../../features/webhooks/webhook-receipt.model.js";
import { WebhookSubscription } from "../../features/webhooks/webhook-subscription.model.js";
import { daysAgo } from "./clock.js";

const SINK = (project) => `http://localhost:8000/api/v1/webhook-sink/${project.webhookSink.token}`;

// Delivered fixtures mirror events the flag/rollout seeders already wrote, by explicit reference — never discovered at run time.
const DELIVERED = {
	storefront: [
		{
			event: "flag.killSwitch.activated",
			flag: "payments-v2",
			at: daysAgo(9, 15),
			data: { reason: "Processor timeouts spiking for EU cards" },
		},
		{ event: "flag.killSwitch.cleared", flag: "payments-v2", at: daysAgo(8, 15), data: {} },
		{
			event: "flag.config.updated",
			flag: "new-checkout",
			environment: "production",
			at: daysAgo(4, 11),
			data: { version: 2, source: "direct", reason: "Turn targeting on ahead of the rollout; everyone stays on the old checkout" },
		},
		{
			event: "rollout.stepApplied",
			flag: "new-checkout",
			environment: "production",
			at: daysAgo(3, 11),
			data: { percent: 5, version: 3 },
		},
		{
			event: "flag.config.updated",
			flag: "new-checkout",
			environment: "production",
			at: daysAgo(3, 11),
			data: { version: 3, source: "rollout", reason: "Rollout step 5%" },
		},
		{
			event: "flag.killSwitch.activated",
			flag: "payments-v2",
			at: daysAgo(2, 15),
			data: { reason: "Elevated payment declines from the new processor" },
		},
		{
			event: "rollout.stepApplied",
			flag: "new-checkout",
			environment: "production",
			at: daysAgo(1, 11),
			data: { percent: 25, version: 4 },
		},
		{
			event: "flag.config.updated",
			flag: "new-checkout",
			environment: "production",
			at: daysAgo(1, 11),
			data: { version: 4, source: "rollout", reason: "Rollout step 25%" },
		},
	],
	mobile: [
		{
			event: "rollout.stepApplied",
			flag: "dark-mode-default",
			environment: "production",
			at: daysAgo(9, 11),
			data: { percent: 50, version: 4 },
		},
		{
			event: "rollout.stepApplied",
			flag: "dark-mode-default",
			environment: "production",
			at: daysAgo(4, 11),
			data: { percent: 100, version: 5 },
		},
		{ event: "rollout.completed", flag: "dark-mode-default", environment: "production", at: daysAgo(4, 11), data: { percent: 100 } },
	],
};
const DEAD = [
	{
		event: "flag.killSwitch.activated",
		flag: "payments-v2",
		at: daysAgo(9, 15),
		data: { reason: "Processor timeouts spiking for EU cards" },
	},
	{ event: "flag.killSwitch.cleared", flag: "payments-v2", at: daysAgo(8, 15), data: {} },
	{
		event: "flag.killSwitch.activated",
		flag: "payments-v2",
		at: daysAgo(2, 15),
		data: { reason: "Elevated payment declines from the new processor" },
	},
];
export const SEED_WEBHOOK_COUNTS = { subscriptions: 3, deliveries: 14, delivered: 11, dead: 3, receipts: 11, audit: 6 };

export async function seedWebhooks(projects, flags, people) {
	console.log("\nSeeding webhooks...");
	const marcus = people.byEmail.get("marcus.chen@rheostat.team");
	const storefront = projects.byKey.get("storefront");
	const mobile = projects.byKey.get("mobile");
	const subscription = (project, name, url, events, environments, createdAt, extra = {}) => ({
		_id: new WebhookSubscription()._id,
		projectId: project._id,
		name,
		url,
		secret: randomBytes(32).toString("hex"),
		events,
		environments,
		enabled: true,
		disabledReason: null,
		consecutiveFailures: 0,
		lastDeliveryAt: null,
		lastDeliveryStatus: null,
		createdBy: marcus._id,
		createdAt,
		updatedAt: createdAt,
		...extra,
	});
	const notifier = subscription(
		storefront,
		"Deploy notifier",
		SINK(storefront),
		[
			"flag.config.updated",
			"flag.killSwitch.activated",
			"flag.killSwitch.cleared",
			"flag.archived",
			"flag.restored",
			"changeRequest.applied",
			"rollout.stepApplied",
			"rollout.stalled",
			"rollout.completed",
			"rollout.aborted",
		],
		[],
		daysAgo(20, 10),
	);
	const pager = subscription(
		storefront,
		"Legacy pager (decommissioned host)",
		"http://127.0.0.1:9/hooks",
		["flag.killSwitch.activated", "flag.killSwitch.cleared", "rollout.stalled"],
		["production"],
		daysAgo(45, 10),
		{ consecutiveFailures: 3, lastDeliveryStatus: "dead" },
	);
	const channel = subscription(
		mobile,
		"Release channel",
		SINK(mobile),
		["rollout.stepApplied", "rollout.stalled", "rollout.completed", "rollout.aborted"],
		[],
		daysAgo(15, 10),
	);
	const deliveries = [];
	const receipts = [];
	const audit = [];
	const payloadFor = (project, fixture, id) => {
		const flag = flags.byKey.get(fixture.flag);
		return {
			id: String(id),
			event: fixture.event,
			occurredAt: fixture.at.toISOString(),
			project: { key: project.key, name: project.name },
			...(fixture.environment ? { environment: fixture.environment } : {}),
			flag: { key: flag.key, name: flag.name },
			data: { ...fixture.data, actorId: String(marcus._id) },
		};
	};
	for (const [target, project] of [
		[notifier, storefront],
		[channel, mobile],
	]) {
		for (const fixture of DELIVERED[project.key]) {
			const id = new WebhookDelivery()._id;
			const payload = payloadFor(project, fixture, id);
			const body = JSON.stringify(payload);
			const durationMs = 40 + (parseInt(id.toString().slice(-2), 16) % 90);
			deliveries.push({
				_id: id,
				subscriptionId: target._id,
				projectId: project._id,
				eventId: String(id),
				event: fixture.event,
				payload,
				status: "delivered",
				attempts: [{ at: fixture.at, outcome: "delivered", durationMs, responseStatus: 204, responseSnippet: "" }],
				budgetFrom: 0,
				nextAttemptAt: fixture.at,
				claimedAt: null,
				deliveredAt: fixture.at,
				createdAt: fixture.at,
				updatedAt: fixture.at,
			});
			receipts.push({
				projectId: project._id,
				subscriptionId: target._id,
				dedupeKey: String(id),
				deliveryId: String(id),
				event: fixture.event,
				firstReceivedAt: fixture.at,
				lastReceivedAt: fixture.at,
				receivedCount: 1,
				headers: {
					"x-rheostat-event": fixture.event,
					"x-rheostat-delivery": String(id),
					"x-rheostat-subscription": String(target._id),
					"x-rheostat-signature": sign(target.secret, body, Math.floor(fixture.at.getTime() / 1000)),
				},
				body,
				signatureValid: true,
				signatureError: "",
			});
			target.lastDeliveryAt = fixture.at;
			target.lastDeliveryStatus = "delivered";
		}
	}
	for (const fixture of DEAD) {
		const id = new WebhookDelivery()._id;
		let at = fixture.at.getTime();
		const attempts = BACKOFF_MS.map((delay) => {
			at += delay;
			return { at: new Date(at), outcome: "failed", durationMs: 3, error: "connect ECONNREFUSED 127.0.0.1:9" };
		});
		deliveries.push({
			_id: id,
			subscriptionId: pager._id,
			projectId: storefront._id,
			eventId: String(id),
			event: fixture.event,
			payload: payloadFor(storefront, fixture, id),
			status: "dead",
			attempts,
			budgetFrom: 0,
			nextAttemptAt: fixture.at,
			claimedAt: null,
			deliveredAt: null,
			createdAt: fixture.at,
			updatedAt: attempts.at(-1).at,
		});
		pager.lastDeliveryAt = attempts.at(-1).at;
		audit.push({
			projectId: storefront._id,
			actorId: SYSTEM_ACTOR_ID,
			actorKind: "system",
			action: "webhook.deliveryDead",
			entityType: "webhook",
			entityId: String(pager._id),
			entityLabel: pager.name,
			summary: `Delivery of ${fixture.event} to ${pager.name} failed 5 times and was dead-lettered.`,
			metadata: { deliveryId: String(id), event: fixture.event, attempts: 5, lastError: "connect ECONNREFUSED 127.0.0.1:9" },
			at: attempts.at(-1).at,
		});
	}
	const subscriptions = [notifier, pager, channel];
	for (const entry of subscriptions) {
		audit.push({
			projectId: entry.projectId,
			actorId: marcus._id,
			action: "webhook.created",
			entityType: "webhook",
			entityId: String(entry._id),
			entityLabel: entry.name,
			summary: `Marcus Chen added webhook "${entry.name}" (${entry.events.length} events).`,
			metadata: { url: entry.url, events: entry.events },
			at: entry.createdAt,
		});
	}
	await WebhookSubscription.insertMany(subscriptions);
	await WebhookDelivery.insertMany(deliveries);
	await WebhookReceipt.insertMany(receipts);
	const actual = {
		subscriptions: subscriptions.length,
		deliveries: deliveries.length,
		delivered: deliveries.filter((d) => d.status === "delivered").length,
		dead: deliveries.filter((d) => d.status === "dead").length,
		receipts: receipts.length,
		audit: audit.length,
	};
	for (const [key, expected] of Object.entries(SEED_WEBHOOK_COUNTS))
		if (actual[key] !== expected) throw new Error(`Webhook seed drift: ${key} expected ${expected}, got ${actual[key]}`);
	console.log(
		`  Created ${actual.subscriptions} webhooks, ${actual.deliveries} deliveries (${actual.dead} dead), ${actual.receipts} receipts`,
	);
	return { subscriptions, deliveries, receipts, audit };
}
