import { describe, expect, test } from "bun:test";
import { diego, harness, input, marcus, mobile, sam, storefront } from "./test-harness.js";


describe("webhookService", () => {
	test("create returns the secret once; get hides it; developers cannot create", async () => {
		const { service } = harness();
		const created = await service.create(storefront, input(), marcus);
		expect(created.secret).toMatch(/^[0-9a-f]{64}$/);
		const fetched = await service.get(created._id, sam);
		expect(fetched.secret).toBeUndefined();
		expect(fetched.secretHint).toBe(`…${created.secret.slice(-4)}`);
		expect(fetched.permissions.canManage).toBe(false);
		await expect(service.create(storefront, input(), diego)).rejects.toMatchObject({ statusCode: 403 });
	});
	test("list is scoped to the project and reports the sink url and counts", async () => {
		const { service } = harness();
		await service.create(storefront, input(), marcus);
		await service.create(mobile, input({ url: "http://localhost:8000/api/v1/webhook-sink/tok2" }), marcus);
		const page = await service.list(storefront, sam);
		expect(page.items).toHaveLength(1);
		expect(page.sinkUrl).toBe("http://localhost:8000/api/v1/webhook-sink/tok1");
		expect(page.items[0].counts).toEqual({ delivered: 0, dead: 0, pending: 0, held: 0 });
	});
	test("test() returns exactly the delivery it created, even when others are created concurrently", async () => {
		const { service, state } = harness();
		const a = await service.create(storefront, input({ name: "A" }), marcus);
		const b = await service.create(storefront, input({ name: "B", url: "http://127.0.0.1:9/dead" }), marcus);
		const [ra, rb] = await Promise.all([service.test(a._id, marcus), service.test(b._id, marcus)]);
		expect(ra.subscriptionId).toBe(a._id);
		expect(rb.subscriptionId).toBe(b._id);
		expect(ra.status).toBe("delivered");
		expect(rb.status).toBe("pending");
		expect(rb.attempts[0].responseStatus).toBe(503);
		expect(state.deliveries).toHaveLength(2);
	});
	test("test() on a disabled subscription → 422 WEBHOOK_DISABLED; enqueue failure propagates", async () => {
		const { service, state } = harness();
		const a = await service.create(storefront, input(), marcus);
		await service.update(a._id, { enabled: false }, marcus);
		await expect(service.test(a._id, marcus)).rejects.toMatchObject({ code: "WEBHOOK_DISABLED" });
		await service.update(a._id, { enabled: true }, marcus);
		const original = state; // simulate a failing insert
		const failing = createWebhookServiceWithFailingInsert(service, original);
		await expect(failing.test(a._id, marcus)).rejects.toThrow("db down");
	});
	test("rotation returns a new secret once and invalidates the old one for signing", async () => {
		const { service, state } = harness();
		const a = await service.create(storefront, input(), marcus);
		const rotated = await service.update(a._id, { rotateSecret: true }, marcus);
		expect(rotated.secret).not.toBe(a.secret);
		expect(state.subscriptions[0].secret).toBe(rotated.secret);
		expect((await service.get(a._id, marcus)).secret).toBeUndefined();
	});
	test("disable holds pending deliveries; enable releases them and resets the counter", async () => {
		const { service, state } = harness();
		const a = await service.create(storefront, input({ url: "http://127.0.0.1:9/dead" }), marcus);
		await service.test(a._id, marcus);
		expect(state.deliveries[0].status).toBe("pending");
		await service.update(a._id, { enabled: false }, marcus);
		expect(state.deliveries[0].status).toBe("held");
		state.subscriptions[0].consecutiveFailures = 4;
		const enabled = await service.update(a._id, { enabled: true }, marcus);
		expect(enabled.consecutiveFailures).toBe(0);
		expect(["pending", "delivering", "dead"].includes(state.deliveries[0].status)).toBe(true);
	});
	test("redeliver starts a fresh budget, preserves history, and returns that delivery", async () => {
		const { service, state } = harness();
		const a = await service.create(storefront, input({ url: "http://127.0.0.1:9/dead" }), marcus);
		const first = await service.test(a._id, marcus);
		Object.assign(state.deliveries[0], { status: "dead", attempts: Array(5).fill({ at: new Date(), outcome: "failed", durationMs: 1 }) });
		const redelivered = await service.redeliver(first._id, marcus);
		expect(redelivered._id).toBe(first._id);
		expect(redelivered.budgetFrom).toBe(5);
		expect(redelivered.attempts).toHaveLength(6);
		expect(redelivered.status).toBe("pending");
		await expect(service.redeliver(first._id, sam)).rejects.toMatchObject({ statusCode: 403 });
	});
	test("deliveries and getDelivery are scoped through the resource, never a client-supplied project", async () => {
		const { service, state } = harness();
		const a = await service.create(storefront, input(), marcus);
		const b = await service.create(mobile, input({ url: "http://localhost:8000/api/v1/webhook-sink/tok2" }), marcus);
		const da = await service.test(a._id, marcus);
		const db = await service.test(b._id, marcus);
		expect((await service.deliveries(a._id, { limit: 10 }, sam)).items.map((d) => d._id)).toEqual([da._id]);
		expect((await service.deliveries(b._id, { limit: 10 }, sam)).items.map((d) => d._id)).toEqual([db._id]);
		expect((await service.getDelivery(db._id, sam)).subscription._id).toBe(b._id);
		expect(state.deliveries).toHaveLength(2);
	});
	test("remove deletes the subscription and its deliveries; stats count dead deliveries per project", async () => {
		const { service, state } = harness();
		const a = await service.create(storefront, input({ url: "http://127.0.0.1:9/dead" }), marcus);
		await service.test(a._id, marcus);
		state.deliveries[0].status = "dead";
		expect(await service.stats("p1")).toEqual({ deadDeliveries: 1, subscriptions: 1 });
		expect(await service.stats("p2")).toEqual({ deadDeliveries: 0, subscriptions: 0 });
		await service.remove(a._id, marcus);
		expect(state.subscriptions).toHaveLength(0);
		expect(state.deliveries).toHaveLength(0);
		expect(state.audit.map((e) => e.action)).toContain("webhook.deleted");
	});
});

// Wraps a service's events with a failing insert to prove enqueue errors surface from test().
function createWebhookServiceWithFailingInsert(service, state) {
	return { test: (id, profile) => service.__withDeliveries({ ...service.__deps.deliveries, insertMany: async () => { throw new Error("db down"); } }).test(id, profile) };
}
