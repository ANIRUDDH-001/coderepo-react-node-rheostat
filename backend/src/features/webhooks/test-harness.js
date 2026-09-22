// In-memory fakes shared by the webhook service and HTTP tests. `objectIds: true` issues real ObjectId strings so
// controllers that validate ids accept them; comparisons are string-based either way.
import mongoose from "mongoose";
import { createWebhookService } from "./webhook.service.js";

export const marcus = { _id: "marcus", name: "Marcus Chen", role: "releaseManager" };
export const diego = { _id: "diego", name: "Diego Alvarez", role: "developer" };
export const sam = { _id: "sam", name: "Sam Okafor", role: "viewer" };
export const storefront = { _id: "p1", key: "storefront", name: "Storefront", webhookSink: { token: "tok1" } };
export const mobile = { _id: "p2", key: "mobile", name: "Mobile app", webhookSink: { token: "tok2" } };

export function harness({ objectIds = false } = {}) {
	const state = { subscriptions: [], deliveries: [], receipts: [], audit: [], sends: [] };
	let ids = 0;
	const nextId = (prefix) => (objectIds ? new mongoose.Types.ObjectId().toString() : `${prefix}${++ids}`);
	const same = (left, right) => String(left) === String(right);
	const subs = {
		findById: async (id) => state.subscriptions.find((s) => same(s._id, id)) || null,
		findByProject: async (projectId) => state.subscriptions.filter((s) => same(s.projectId, projectId)),
		findEnabledByProject: async (projectId) => state.subscriptions.filter((s) => same(s.projectId, projectId) && s.enabled),
		findDisabledIds: async () => state.subscriptions.filter((s) => !s.enabled).map((s) => s._id),
		countByProject: async (projectId) => state.subscriptions.filter((s) => same(s.projectId, projectId)).length,
		create: async (input) => { const doc = { _id: nextId("s"), enabled: true, consecutiveFailures: 0, disabledReason: null, ...input }; state.subscriptions.push(doc); return { ...doc }; },
		update: async (id, patch) => Object.assign(state.subscriptions.find((s) => same(s._id, id)), patch),
		remove: async (id) => { state.subscriptions = state.subscriptions.filter((s) => !same(s._id, id)); },
		recordOutcome: async (id, outcome, at) => { const s = state.subscriptions.find((x) => same(x._id, id)); Object.assign(s, outcome === "delivered" ? { consecutiveFailures: 0, lastDeliveryStatus: "delivered", lastDeliveryAt: at } : { consecutiveFailures: s.consecutiveFailures + 1, lastDeliveryStatus: "dead", lastDeliveryAt: at }); return { ...s }; },
		disableAuto: async (id) => { const s = state.subscriptions.find((x) => same(x._id, id)); if (!s.enabled) return false; Object.assign(s, { enabled: false, disabledReason: "AUTO_FAILURES" }); return true; },
	};
	const dels = {
		findById: async (id) => state.deliveries.find((d) => same(d._id, id)) || null,
		insertMany: async (docs) => { const inserted = docs.map((doc) => ({ ...doc, _id: nextId("d"), createdAt: new Date() })); state.deliveries.push(...inserted); return inserted; },
		claimNext: async (now, exclude = []) => { const d = state.deliveries.find((x) => x.status === "pending" && x.nextAttemptAt <= now && !exclude.map(String).includes(String(x.subscriptionId))); if (!d) return null; Object.assign(d, { status: "delivering", claimedAt: now }); return { ...d }; },
		claimById: async (id, now) => { const d = state.deliveries.find((x) => same(x._id, id)); if (!d || d.status !== "pending") return null; Object.assign(d, { status: "delivering", claimedAt: now }); return { ...d }; },
		releaseStale: async () => {},
		finish: async (id, patch) => Object.assign(state.deliveries.find((d) => same(d._id, id)), patch),
		requeue: async (id, now, budgetFrom) => Object.assign(state.deliveries.find((d) => same(d._id, id)), { status: "pending", nextAttemptAt: now, claimedAt: null, budgetFrom }),
		holdPending: async (sid) => { for (const d of state.deliveries) if (same(d.subscriptionId, sid) && d.status === "pending") d.status = "held"; },
		releaseHeld: async (sid, now) => { for (const d of state.deliveries) if (same(d.subscriptionId, sid) && d.status === "held") Object.assign(d, { status: "pending", nextAttemptAt: now }); },
		// Mirrors the repository's compound cursor: newest first by (createdAt, _id), rows strictly after the cursor.
		findPage: async (sid, { status, cursor = null, limit }) =>
			state.deliveries
				.filter((d) => same(d.subscriptionId, sid) && (!status || d.status === status))
				.filter((d) => !cursor || d.createdAt < cursor.createdAt || (d.createdAt.getTime() === cursor.createdAt.getTime() && String(d._id) < cursor.id))
				.sort((a, b) => b.createdAt - a.createdAt || (String(b._id) > String(a._id) ? 1 : -1))
				.slice(0, limit + 1),
		countByStatus: async (filter) => { const rows = state.deliveries.filter((d) => Object.entries(filter).every(([k, v]) => same(d[k], v))); const by = {}; for (const r of rows) by[r.status] = (by[r.status] || 0) + 1; return Object.entries(by).map(([_id, count]) => ({ _id, count })); },
		removeForSubscription: async (sid) => { state.deliveries = state.deliveries.filter((d) => !same(d.subscriptionId, sid)); },
	};
	const receipts = { findRecent: async (projectId) => state.receipts.filter((r) => same(r.projectId, projectId)), clear: async (projectId) => { state.receipts = state.receipts.filter((r) => !same(r.projectId, projectId)); } };
	const service = createWebhookService({
		subscriptions: subs,
		deliveries: dels,
		receipts,
		projects: { getById: async (id) => [storefront, mobile].find((p) => same(p._id, id)) },
		audit: { record: async (entry) => state.audit.push(entry) },
		send: async (url, body, headers) => { state.sends.push({ url, body, headers }); return url.includes("/dead") ? { status: 503, snippet: "down" } : { status: 204, snippet: "" }; },
		apiOrigin: "http://localhost:8000",
	});
	return { state, service };
}
export const input = (overrides = {}) => ({ name: "Notifier", url: "http://localhost:8000/api/v1/webhook-sink/tok1", events: ["flag.archived"], environments: [], ...overrides });
