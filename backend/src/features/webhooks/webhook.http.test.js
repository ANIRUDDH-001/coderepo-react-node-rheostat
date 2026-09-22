import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import express from "express";
import mongoose from "mongoose";
import { errorHandler, notFoundHandler } from "../../shared/middleware/error-handler.js";
import { requestContext } from "../../shared/middleware/request-context.js";
import { harness, input, marcus, mobile, sam, storefront } from "./test-harness.js";
import { createWebhookRouters } from "./webhook.routes.js";

const oid = () => new mongoose.Types.ObjectId().toString();
let server;
let base;
let h;
const profiles = { marcus, sam };
beforeAll(async () => {
	h = harness({ objectIds: true }); // harness option: ids are real ObjectId strings so objectIdSchema accepts them
	const app = express();
	app.use("/api", requestContext);
	app.use(express.json({ limit: "200kb" }));
	app.use((request, response, next) => {
		request.profile = profiles[request.get("x-test-profile") || "marcus"];
		request.profileId = request.profile._id;
		next();
	});
	const routers = createWebhookRouters(h.service, {
		projects: { getByKey: async (key) => [storefront, mobile].find((p) => p.key === key) },
		people: { attachActors: async (items) => items },
	});
	app.use("/api/v1/projects/:projectKey/webhooks", routers.projectWebhookRouter);
	app.use("/api/v1/webhooks", routers.webhookRouter);
	app.use("/api/v1/deliveries", routers.deliveryRouter);
	app.use(notFoundHandler);
	app.use(errorHandler);
	server = app.listen(0, "127.0.0.1");
	await new Promise((resolve) => server.once("listening", resolve));
	base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
afterAll(() => server.close());
const call = (method, path, { body, profile = "marcus" } = {}) =>
	fetch(`${base}${path}`, {
		method,
		headers: { "content-type": "application/json", "x-test-profile": profile },
		body: body === undefined ? undefined : JSON.stringify(body),
	});

describe("webhook HTTP API", () => {
	let created;
	test("POST create → 201 with secret; validation → 400 envelope; viewer → 403", async () => {
		const response = await call("POST", "/projects/storefront/webhooks", { body: input() });
		expect(response.status).toBe(201);
		created = (await response.json()).data;
		expect(created.secret).toMatch(/^[0-9a-f]{64}$/);
		const bad = await call("POST", "/projects/storefront/webhooks", { body: input({ url: "ftp://x", events: [] }) });
		expect(bad.status).toBe(400);
		const envelope = await bad.json();
		expect(envelope.error.code).toBe("VALIDATION_ERROR");
		expect(envelope.error.details.fieldErrors.url[0]).toBe("Enter an absolute http(s) URL.");
		expect(envelope.error.requestId).toBeTruthy();
		expect((await call("POST", "/projects/storefront/webhooks", { body: input(), profile: "sam" })).status).toBe(403);
	});
	test("GET hides the secret; list is project-scoped; unknown id → 404; malformed id → 400", async () => {
		const detail = (await (await call("GET", `/webhooks/${created._id}`, { profile: "sam" })).json()).data;
		expect(detail.secret).toBeUndefined();
		expect(detail.secretHint).toHaveLength(5);
		const other = (
			await (
				await call("POST", "/projects/mobile/webhooks", { body: input({ url: "http://localhost:8000/api/v1/webhook-sink/tok2" }) })
			).json()
		).data;
		const list = (await (await call("GET", "/projects/storefront/webhooks")).json()).data;
		expect(list.items.map((item) => item._id)).toEqual([created._id]);
		expect(list.items[0]._id).not.toBe(other._id);
		expect((await call("GET", `/webhooks/${oid()}`)).status).toBe(404);
		expect((await call("GET", "/webhooks/not-an-id")).status).toBe(400);
	});
	test("PATCH rotates once; unknown fields → 400; DELETE → 204 then 404", async () => {
		const rotated = (await (await call("PATCH", `/webhooks/${created._id}`, { body: { rotateSecret: true } })).json()).data;
		expect(rotated.secret).toMatch(/^[0-9a-f]{64}$/);
		expect(rotated.secret).not.toBe(created.secret);
		expect((await call("PATCH", `/webhooks/${created._id}`, { body: { nope: 1 } })).status).toBe(400);
		expect((await call("PATCH", `/webhooks/${created._id}`, { body: {} })).status).toBe(400);
		const victim = (await (await call("POST", "/projects/storefront/webhooks", { body: input({ name: "Victim" }) })).json()).data;
		expect((await call("DELETE", `/webhooks/${victim._id}`)).status).toBe(204);
		expect((await call("GET", `/webhooks/${victim._id}`)).status).toBe(404);
	});
	test("POST test returns the created delivery; GET deliveries paginates with a cursor; redeliver keeps history", async () => {
		const first = (await (await call("POST", `/webhooks/${created._id}/test`)).json()).data;
		expect(first.subscriptionId).toBe(created._id);
		expect(first.status).toBe("delivered");
		const second = (await (await call("POST", `/webhooks/${created._id}/test`)).json()).data;
		expect(second._id).not.toBe(first._id);
		const page1 = (await (await call("GET", `/webhooks/${created._id}/deliveries?limit=1`)).json()).data;
		expect(page1.items).toHaveLength(1);
		expect(page1.nextCursor).toBeTruthy();
		const page2 = (
			await (await call("GET", `/webhooks/${created._id}/deliveries?limit=1&cursor=${encodeURIComponent(page1.nextCursor)}`)).json()
		).data;
		expect(page2.items[0]._id).not.toBe(page1.items[0]._id);
		expect((await call("GET", `/webhooks/${created._id}/deliveries?cursor=garbage`)).status).toBe(400);
		const redelivered = (await (await call("POST", `/deliveries/${first._id}/redeliver`)).json()).data;
		expect(redelivered._id).toBe(first._id);
		expect(redelivered.attempts).toHaveLength(2);
		expect(redelivered.budgetFrom).toBe(1);
		expect((await call("POST", `/deliveries/${first._id}/redeliver`, { profile: "sam" })).status).toBe(403);
		expect((await call("GET", `/deliveries/${oid()}`)).status).toBe(404);
	});
	test("receipts are project-scoped and clearable by managers only", async () => {
		expect((await call("GET", "/projects/storefront/webhooks/sink/receipts", { profile: "sam" })).status).toBe(200);
		expect((await call("DELETE", "/projects/storefront/webhooks/sink/receipts", { profile: "sam" })).status).toBe(403);
		expect((await call("DELETE", "/projects/storefront/webhooks/sink/receipts")).status).toBe(204);
	});
});
