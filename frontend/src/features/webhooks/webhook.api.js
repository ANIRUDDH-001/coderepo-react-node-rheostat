import { invalidate } from "../../shared/api/cache.js";
import { request } from "../../shared/api/client.js";
import { stringifyQuery } from "../../shared/router/match.js";

// Mirror of the backend catalogue (events-catalogue.js); `webhook.test` is sent by the Test button, never subscribed to.
export const WEBHOOK_EVENT_GROUPS = {
	flag: ["flag.config.updated", "flag.killSwitch.activated", "flag.killSwitch.cleared", "flag.archived", "flag.restored"],
	changeRequest: ["changeRequest.applied"],
	rollout: ["rollout.stepApplied", "rollout.stalled", "rollout.completed", "rollout.aborted"],
};
export const WEBHOOK_EVENTS = Object.values(WEBHOOK_EVENT_GROUPS).flat();
export const EVENT_GROUP_LABELS = { flag: "Flags", changeRequest: "Change requests", rollout: "Rollouts" };

const projectBase = (projectKey) => `/projects/${encodeURIComponent(projectKey)}/webhooks`;
const id = (value) => encodeURIComponent(value);
// The list and detail pages cache per project; subscription- and delivery-scoped calls carry the key as a last argument.
const refresh = (projectKey, promise) => promise.then((result) => (invalidate(`webhooks:${projectKey}`), result));

export const webhookApi = {
	list: (projectKey) => request(projectBase(projectKey)),
	create: (projectKey, input) => refresh(projectKey, request(projectBase(projectKey), { method: "POST", body: JSON.stringify(input) })),
	get: (subscriptionId) => request(`/webhooks/${id(subscriptionId)}`),
	update: (subscriptionId, patch, projectKey) =>
		refresh(projectKey, request(`/webhooks/${id(subscriptionId)}`, { method: "PATCH", body: JSON.stringify(patch) })),
	remove: (subscriptionId, projectKey) => refresh(projectKey, request(`/webhooks/${id(subscriptionId)}`, { method: "DELETE" })),
	deliveries: (subscriptionId, { status = "", cursor = "" } = {}) =>
		request(`/webhooks/${id(subscriptionId)}/deliveries${stringifyQuery({ status, cursor })}`),
	delivery: (deliveryId) => request(`/deliveries/${id(deliveryId)}`),
	redeliver: (deliveryId, projectKey) => refresh(projectKey, request(`/deliveries/${id(deliveryId)}/redeliver`, { method: "POST" })),
	test: (subscriptionId, projectKey) => refresh(projectKey, request(`/webhooks/${id(subscriptionId)}/test`, { method: "POST" })),
	receipts: (projectKey) => request(`${projectBase(projectKey)}/sink/receipts`),
	clearReceipts: (projectKey) => request(`${projectBase(projectKey)}/sink/receipts`, { method: "DELETE" }),
};
