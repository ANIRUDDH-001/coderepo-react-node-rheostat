import { describe, expect, test } from "bun:test";
import { BACKOFF_MS, createDispatcher, headersFor } from "./dispatch.js";
import { verify } from "./signature.js";

const NOW = new Date("2026-09-21T10:00:00Z");
const at = (offsetMs) => new Date(NOW.getTime() + offsetMs);

function harness({ deliveries = [], subscriptions = [], sendImpl, clockStep = 12 } = {}) {
	const state = {
		deliveries: structuredClone(deliveries),
		subscriptions: structuredClone(subscriptions),
		audit: [],
		sends: [],
		clock: 0,
	};
	const find = (id) => state.deliveries.find((entry) => String(entry._id) === String(id));
	const subOf = (id) => state.subscriptions.find((entry) => String(entry._id) === String(id));
	const deps = {
		deliveries: {
			releaseStale: async (before) => {
				for (const entry of state.deliveries)
					if (entry.status === "delivering" && entry.claimedAt < before)
						Object.assign(entry, { status: "pending", claimedAt: null });
			},
			claimNext: async (now, exclude = []) => {
				const excluded = new Set(exclude.map(String));
				const entry = state.deliveries
					.filter((d) => d.status === "pending" && d.nextAttemptAt <= now && !excluded.has(String(d.subscriptionId)))
					.sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)[0];
				if (!entry) return null;
				Object.assign(entry, { status: "delivering", claimedAt: now });
				return structuredClone(entry);
			},
			claimById: async (id, now) => {
				const entry = find(id);
				if (!entry || entry.status !== "pending") return null;
				Object.assign(entry, { status: "delivering", claimedAt: now });
				return structuredClone(entry);
			},
			finish: async (id, patch) => Object.assign(find(id), patch),
			holdPending: async (subscriptionId) => {
				for (const entry of state.deliveries)
					if (String(entry.subscriptionId) === String(subscriptionId) && entry.status === "pending") entry.status = "held";
			},
		},
		subscriptions: {
			findById: async (id) => structuredClone(subOf(id) || null),
			findDisabledIds: async () => state.subscriptions.filter((s) => !s.enabled).map((s) => s._id),
			recordOutcome: async (id, outcome, when) => {
				const s = subOf(id);
				Object.assign(
					s,
					outcome === "delivered"
						? { consecutiveFailures: 0, lastDeliveryStatus: "delivered", lastDeliveryAt: when }
						: { consecutiveFailures: s.consecutiveFailures + 1, lastDeliveryStatus: "dead", lastDeliveryAt: when },
				);
				return structuredClone(s);
			},
			disableAuto: async (id) => {
				const s = subOf(id);
				if (!s.enabled) return false;
				Object.assign(s, { enabled: false, disabledReason: "AUTO_FAILURES" });
				return true;
			},
		},
		send: async (url, body, headers) => {
			state.sends.push({ url, body, headers });
			state.clock += clockStep;
			return sendImpl ? sendImpl(url, body, headers) : { status: 200, snippet: "ok" };
		},
		audit: { record: async (entry) => state.audit.push(entry) },
		log: { info() {}, warn() {}, error() {} },
		clock: () => state.clock,
	};
	return { state, dispatcher: createDispatcher(deps), deps };
}

const subscription = (overrides = {}) => ({
	_id: "s1",
	projectId: "p1",
	name: "Hook",
	url: "http://127.0.0.1:9/hook",
	secret: "sec",
	enabled: true,
	consecutiveFailures: 0,
	createdBy: "marcus",
	...overrides,
});
const delivery = (overrides = {}) => ({
	_id: "d1",
	subscriptionId: "s1",
	projectId: "p1",
	eventId: "e1",
	event: "flag.archived",
	payload: { id: "e1" },
	status: "pending",
	attempts: [],
	budgetFrom: 0,
	nextAttemptAt: NOW,
	claimedAt: null,
	...overrides,
});
const failed = (n) => Array.from({ length: n }, () => ({ at: NOW, outcome: "failed", durationMs: 1 }));

describe("dispatchDue", () => {
	test("delivers with signed headers, records real duration, resets the failure counter", async () => {
		const h = harness({ deliveries: [delivery()], subscriptions: [subscription({ consecutiveFailures: 2 })] });
		expect(await h.dispatcher.dispatchDue(NOW)).toEqual({ sent: 1, delivered: 1, failed: 0 });
		const d = h.state.deliveries[0];
		expect(d.status).toBe("delivered");
		expect(d.attempts[0]).toMatchObject({ outcome: "delivered", responseStatus: 200, durationMs: 12 });
		expect(h.state.subscriptions[0].consecutiveFailures).toBe(0);
		const { headers, body } = h.state.sends[0];
		expect(headers["X-Rheostat-Delivery"]).toBe("d1");
		expect(verify("sec", body, headers["X-Rheostat-Signature"], { nowSeconds: Math.floor(NOW.getTime() / 1000) })).toEqual({
			valid: true,
		});
	});
	test("a failure schedules the next attempt from the backoff table", async () => {
		const h = harness({
			deliveries: [delivery()],
			subscriptions: [subscription()],
			sendImpl: async () => ({ status: 503, snippet: "down" }),
		});
		await h.dispatcher.dispatchDue(NOW);
		const d = h.state.deliveries[0];
		expect(d.status).toBe("pending");
		expect(d.attempts[0]).toMatchObject({ outcome: "failed", responseStatus: 503, responseSnippet: "down" });
		expect(d.nextAttemptAt).toEqual(at(BACKOFF_MS[1]));
		await h.dispatcher.dispatchDue(at(BACKOFF_MS[1] - 1000));
		expect(d.attempts).toHaveLength(1);
		await h.dispatcher.dispatchDue(at(BACKOFF_MS[1]));
		expect(d.attempts).toHaveLength(2);
		expect(d.nextAttemptAt).toEqual(at(BACKOFF_MS[1] + BACKOFF_MS[2]));
	});
	test("timeouts and connection errors record their elapsed duration", async () => {
		const h = harness({
			deliveries: [delivery()],
			subscriptions: [subscription()],
			clockStep: 5000,
			sendImpl: async () => {
				throw Object.assign(new Error("The operation timed out"), { name: "TimeoutError" });
			},
		});
		await h.dispatcher.dispatchDue(NOW);
		expect(h.state.deliveries[0].attempts[0]).toMatchObject({ outcome: "failed", error: "timeout", durationMs: 5000 });
	});
	test("the fifth failure dead-letters, audits once, increments the counter", async () => {
		const h = harness({
			deliveries: [delivery({ attempts: failed(4) })],
			subscriptions: [subscription({ consecutiveFailures: 1 })],
			sendImpl: async () => {
				throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
			},
		});
		await h.dispatcher.dispatchDue(NOW);
		expect(h.state.deliveries[0].status).toBe("dead");
		expect(h.state.deliveries[0].attempts[4].error).toContain("ECONNREFUSED");
		expect(h.state.subscriptions[0].consecutiveFailures).toBe(2);
		expect(h.state.audit.map((entry) => entry.action)).toEqual(["webhook.deliveryDead"]);
	});
	test("redelivery budget: attempts after budgetFrom count, history before it does not", async () => {
		const h = harness({
			deliveries: [delivery({ attempts: failed(5), budgetFrom: 5 })],
			subscriptions: [subscription()],
			sendImpl: async () => ({ status: 500, snippet: "" }),
		});
		await h.dispatcher.dispatchDue(NOW);
		const d = h.state.deliveries[0];
		expect(d.status).toBe("pending");
		expect(d.attempts).toHaveLength(6);
		expect(d.nextAttemptAt).toEqual(at(BACKOFF_MS[1]));
	});
	test("the breaker trips at five consecutive dead deliveries, holds pending ones, and never claims held rows", async () => {
		const h = harness({
			deliveries: [
				delivery({ attempts: failed(4) }),
				delivery({ _id: "d2", eventId: "e2", nextAttemptAt: at(1000) }),
				...Array.from({ length: 30 }, (_, i) => delivery({ _id: `h${i}`, eventId: `h${i}`, status: "held" })),
			],
			subscriptions: [subscription({ consecutiveFailures: 4 }), subscription({ _id: "s2" })],
			sendImpl: async (url) => (url.endsWith("/ok") ? { status: 200, snippet: "" } : { status: 500, snippet: "" }),
		});
		h.state.subscriptions[1].url = "http://127.0.0.1:9/ok";
		h.state.deliveries.push(delivery({ _id: "d3", eventId: "e3", subscriptionId: "s2", nextAttemptAt: at(1000) }));
		await h.dispatcher.dispatchDue(NOW);
		expect(h.state.subscriptions[0]).toMatchObject({ enabled: false, disabledReason: "AUTO_FAILURES" });
		expect(h.state.audit.map((entry) => entry.action)).toEqual(["webhook.deliveryDead", "webhook.autoDisabled"]);
		expect(h.state.deliveries[1].status).toBe("held");
		const result = await h.dispatcher.dispatchDue(at(2000));
		expect(result).toEqual({ sent: 1, delivered: 1, failed: 0 });
		expect(h.state.deliveries.find((d) => d._id === "d3").status).toBe("delivered");
		expect(h.state.sends).toHaveLength(2);
	});
	test("a large pending backlog for a disabled subscription cannot starve an enabled one", async () => {
		const backlog = Array.from({ length: 500 }, (_, i) =>
			delivery({ _id: `x${i}`, eventId: `x${i}`, subscriptionId: "sDisabled", nextAttemptAt: at(-1000 - i) }),
		);
		const h = harness({
			deliveries: [...backlog, delivery({ _id: "live", eventId: "live", subscriptionId: "sLive" })],
			subscriptions: [subscription({ _id: "sDisabled", enabled: false, disabledReason: "MANUAL" }), subscription({ _id: "sLive" })],
		});
		const result = await h.dispatcher.dispatchDue(NOW);
		expect(result).toEqual({ sent: 1, delivered: 1, failed: 0 });
		expect(h.state.deliveries.find((d) => d._id === "live").status).toBe("delivered");
		expect(h.state.sends).toHaveLength(1);
	});
	test("a row claimed for a subscription disabled after the exclusion set was read moves its whole backlog to held in one claim", async () => {
		const h = harness({
			deliveries: [
				delivery(),
				delivery({ _id: "d2", eventId: "e2" }),
				delivery({ _id: "live", eventId: "live", subscriptionId: "s2" }),
			],
			subscriptions: [subscription(), subscription({ _id: "s2" })],
		});
		const original = h.deps.subscriptions.findDisabledIds;
		h.deps.subscriptions.findDisabledIds = async () => {
			const ids = await original();
			h.state.subscriptions[0].enabled = false;
			return ids;
		}; // disabled between exclusion read and claim
		const result = await h.dispatcher.dispatchDue(NOW);
		expect(h.state.deliveries.filter((d) => d.subscriptionId === "s1").map((d) => d.status)).toEqual(["held", "held"]);
		expect(result).toEqual({ sent: 1, delivered: 1, failed: 0 });
		expect(h.state.sends).toHaveLength(1);
	});
	test("automated audit entries use the system actor, not the subscription creator", async () => {
		const h = harness({
			deliveries: [delivery({ attempts: failed(4) })],
			subscriptions: [subscription()],
			sendImpl: async () => ({ status: 500, snippet: "" }),
		});
		await h.dispatcher.dispatchDue(NOW);
		expect(String(h.state.audit[0].actor._id)).toBe("000000000000000000000001");
		expect(h.state.audit[0].actorKind).toBe("system");
		expect(h.state.audit[0].metadata.subscriptionCreatedBy).toBe("marcus");
	});
	test("a stale delivering claim is released and sent; a fresh one is left alone", async () => {
		const h = harness({
			deliveries: [
				delivery({ status: "delivering", claimedAt: at(-61000) }),
				delivery({ _id: "d2", eventId: "e2", status: "delivering", claimedAt: at(-1000) }),
			],
			subscriptions: [subscription()],
		});
		await h.dispatcher.dispatchDue(NOW);
		expect(h.state.deliveries[0].status).toBe("delivered");
		expect(h.state.deliveries[1].status).toBe("delivering");
	});
	test("two concurrent passes send a delivery once (fake-level claim semantics)", async () => {
		const h = harness({ deliveries: [delivery()], subscriptions: [subscription()] });
		await Promise.all([h.dispatcher.dispatchDue(NOW), h.dispatcher.dispatchDue(NOW)]);
		expect(h.state.sends).toHaveLength(1);
	});
	test("dispatchOne sends exactly the named delivery", async () => {
		const h = harness({ deliveries: [delivery(), delivery({ _id: "d2", eventId: "e2" })], subscriptions: [subscription()] });
		expect(await h.dispatcher.dispatchOne("d2", NOW)).toBe("delivered");
		expect(h.state.deliveries[1].status).toBe("delivered");
		expect(h.state.deliveries[0].status).toBe("pending");
		expect(await h.dispatcher.dispatchOne("missing", NOW)).toBe("missing");
	});
	test("headersFor signs with the subscription secret", () => {
		const headers = headersFor(subscription(), delivery(), '{"a":1}', 1700000000);
		expect(headers["Content-Type"]).toBe("application/json");
		expect(headers["X-Rheostat-Subscription"]).toBe("s1");
		expect(verify("sec", '{"a":1}', headers["X-Rheostat-Signature"], { nowSeconds: 1700000000 })).toEqual({ valid: true });
	});
});
