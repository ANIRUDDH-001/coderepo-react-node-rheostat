import { randomUUID } from "node:crypto";
import { logger } from "../../shared/logging/logger.js";
import { WEBHOOK_EVENTS } from "./events-catalogue.js";
import { fanout } from "./fanout.js";
import { deliveryRepository, subscriptionRepository } from "./webhook.repository.js";

export function createEvents({ subscriptions, deliveries, log = logger, dispatchNow = async () => {} }) {
	let kick = dispatchNow;
	const buildPayload = ({ event, eventId, project, environment, flag, data, occurredAt }) => ({
		id: eventId,
		event,
		occurredAt: occurredAt.toISOString(),
		project: { key: project.key, name: project.name },
		...(environment ? { environment } : {}),
		...(flag ? { flag: { key: flag.key, name: flag.name } } : {}),
		data,
	});
	return {
		__setDispatch(fn) {
			kick = fn;
		},
		// Inserts one delivery per matching subscription and returns exactly those documents. Throws on failure.
		// Enqueue success is the insert; the dispatch kick afterwards is fire-and-forget and logged on its own.
		// Business events carry deterministic ids (spec §9.2); only webhook.test may use a random one.
		async enqueue({ event, eventId, project, environment = null, flag = null, data = {}, occurredAt = new Date(), onlySubscriptionId = null }) {
			if (!WEBHOOK_EVENTS.includes(event)) throw new Error(`Unknown webhook event ${event}`);
			if (!eventId && event !== "webhook.test") throw new Error(`eventId is required for ${event}`);
			const id = eventId || `test:${randomUUID()}`;
			const candidates = await subscriptions.findEnabledByProject(project._id);
			const payload = buildPayload({ event, eventId: id, project, environment, flag, data, occurredAt });
			const docs = fanout({ subscriptions: candidates, event, environment, eventId: id, payload, projectId: project._id, now: occurredAt, onlySubscriptionId });
			if (!docs.length) return [];
			const inserted = await deliveries.insertMany(docs);
			Promise.resolve()
				.then(() => kick())
				.catch((error) => log.warn("webhook.dispatch.kick.failed", { eventId: id, error }));
			return inserted;
		},
		// Best-effort wrapper for owning services: never throws, logs the failure with the event id.
		async emit(input) {
			try {
				return { enqueued: (await this.enqueue(input)).length };
			} catch (error) {
				log.error("webhook.emit.failed", { webhookEvent: input.event, eventId: input.eventId || null, error });
				return { enqueued: 0 };
			}
		},
	};
}

let dispatchNow = async () => {};
export const setDispatcher = (fn) => {
	dispatchNow = fn;
};
export const webhookEvents = createEvents({ subscriptions: subscriptionRepository, deliveries: deliveryRepository, dispatchNow: () => dispatchNow().catch((error) => logger.warn("webhook.dispatch.failed", { error })) });
