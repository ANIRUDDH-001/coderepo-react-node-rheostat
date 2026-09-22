import { describe, expect, test } from "bun:test";
import { fanout } from "./fanout.js";

const now = new Date("2026-09-21T10:00:00Z");
const sub = (overrides) => ({ _id: "s1", enabled: true, events: ["flag.config.updated"], environments: [], ...overrides });
const base = { event: "flag.config.updated", environment: "production", eventId: "e1", payload: { id: "e1" }, projectId: "p1", now };

describe("fanout", () => {
	test("one pending delivery per enabled subscription that lists the event", () => {
		const docs = fanout({ ...base, subscriptions: [sub(), sub({ _id: "s2", events: ["rollout.stalled"] }), sub({ _id: "s3", enabled: false })] });
		expect(docs.map((doc) => doc.subscriptionId)).toEqual(["s1"]);
		expect(docs[0]).toMatchObject({ status: "pending", eventId: "e1", event: "flag.config.updated", nextAttemptAt: now, attempts: [], budgetFrom: 0 });
	});
	test("environment filters apply only to events that carry an environment", () => {
		const docs = fanout({ ...base, subscriptions: [sub({ environments: ["staging"] }), sub({ _id: "s2", environments: ["production"] })] });
		expect(docs.map((doc) => doc.subscriptionId)).toEqual(["s2"]);
		const flagLevel = fanout({ ...base, event: "flag.archived", environment: null, subscriptions: [sub({ events: ["flag.archived"], environments: ["staging"] })] });
		expect(flagLevel).toHaveLength(1);
	});
	test("onlySubscriptionId restricts fan-out and webhook.test ignores the event filter", () => {
		const docs = fanout({ ...base, event: "webhook.test", subscriptions: [sub(), sub({ _id: "s2" })], onlySubscriptionId: "s2" });
		expect(docs.map((doc) => doc.subscriptionId)).toEqual(["s2"]);
	});
});
