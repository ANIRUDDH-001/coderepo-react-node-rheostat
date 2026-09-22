import { describe, expect, test } from "bun:test";
import { createEvents } from "./events.js";

const project = { _id: "p1", key: "storefront", name: "Storefront" };
const sub = (overrides) => ({ _id: "s1", projectId: "p1", enabled: true, events: ["flag.archived"], environments: [], ...overrides });
function harness({ subscriptions = [sub()], insertImpl } = {}) {
	const state = { inserted: [], logs: [], dispatched: 0 };
	const events = createEvents({
		subscriptions: { findEnabledByProject: async () => subscriptions },
		deliveries: {
			insertMany:
				insertImpl ||
				(async (docs) => {
					state.inserted.push(...docs);
					return docs.map((doc, index) => ({ ...doc, _id: `d${state.inserted.length - docs.length + index + 1}` }));
				}),
		},
		log: {
			error: (event, fields) => state.logs.push({ event, ...fields }),
			warn: (event, fields) => state.logs.push({ event, ...fields }),
		},
		dispatchNow: async () => {
			state.dispatched += 1;
		},
	});
	return { state, events };
}

describe("webhook events", () => {
	test("enqueue returns the inserted deliveries and kicks the dispatcher", async () => {
		const h = harness();
		const docs = await h.events.enqueue({
			event: "flag.archived",
			eventId: "audit:a1",
			project,
			flag: { key: "f", name: "F" },
			data: { actorId: "a" },
		});
		expect(docs).toHaveLength(1);
		expect(docs[0]._id).toBe("d1");
		expect(docs[0].eventId).toBe("audit:a1");
		expect(docs[0].payload).toMatchObject({
			event: "flag.archived",
			project: { key: "storefront", name: "Storefront" },
			flag: { key: "f", name: "F" },
			data: { actorId: "a" },
		});
		await Promise.resolve();
		expect(h.state.dispatched).toBe(1);
	});
	test("a failing dispatch kick does not change the enqueue result and is logged separately", async () => {
		const h = harness();
		h.events.__setDispatch(async () => {
			throw new Error("kick failed");
		});
		expect(await h.events.emit({ event: "flag.archived", eventId: "audit:a2", project })).toEqual({ enqueued: 1 });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(h.state.logs.map((line) => line.event)).toEqual(["webhook.dispatch.kick.failed"]);
	});
	test("business events must carry a deterministic id; only webhook.test may omit it", async () => {
		const h = harness();
		await expect(h.events.enqueue({ event: "flag.archived", project })).rejects.toThrow("eventId is required");
		await expect(h.events.enqueue({ event: "webhook.test", project, onlySubscriptionId: "s1" })).resolves.toBeDefined();
	});
	test("enqueue with no matching subscription returns [] without dispatching", async () => {
		const h = harness({ subscriptions: [sub({ events: ["rollout.stalled"] })] });
		expect(await h.events.enqueue({ event: "flag.archived", eventId: "audit:a3", project })).toEqual([]);
		expect(h.state.dispatched).toBe(0);
	});
	test("enqueue throws on insert failure; emit swallows and logs it", async () => {
		const h = harness({
			insertImpl: async () => {
				throw new Error("db down");
			},
		});
		await expect(h.events.enqueue({ event: "flag.archived", eventId: "audit:a4", project })).rejects.toThrow("db down");
		expect(await h.events.emit({ event: "flag.archived", eventId: "e7", project })).toEqual({ enqueued: 0 });
		expect(h.state.logs[0]).toMatchObject({ event: "webhook.emit.failed", eventId: "e7" });
	});
	test("unknown events are rejected", async () => {
		const h = harness();
		await expect(h.events.enqueue({ event: "nope", eventId: "x", project })).rejects.toThrow("Unknown webhook event");
	});
});
