import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import express from "express";
import mongoose from "mongoose";
import { errorHandler, notFoundHandler } from "../../shared/middleware/error-handler.js";
import { requestContext } from "../../shared/middleware/request-context.js";
import { sign } from "./signature.js";
import { createSinkRouter } from "./sink.controller.js";

const subscriptionId = new mongoose.Types.ObjectId().toString();
const otherProjectSubscriptionId = new mongoose.Types.ObjectId().toString();
const rateSubscriptionId = new mongoose.Types.ObjectId().toString();
const state = { receipts: [] };
// Fake receipt store with the same atomicity as the unique-index upsert: one document per (projectId, dedupeKey).
const record = async (doc) => {
	const existing = state.receipts.find((r) => r.projectId === doc.projectId && r.dedupeKey === doc.dedupeKey);
	if (existing) {
		existing.receivedCount += 1;
		existing.lastReceivedAt = doc.lastReceivedAt;
		return existing;
	}
	const created = { ...doc, firstReceivedAt: doc.lastReceivedAt, receivedCount: 1 };
	state.receipts.push(created);
	return created;
};
let server;
let base;
let clock = 1700000000000;
beforeAll(async () => {
	const app = express();
	app.use("/api", requestContext);
	app.use(
		"/api/v1/webhook-sink",
		createSinkRouter({
			projects: {
				findBySinkToken: async (token) => ({ tok1: { _id: "p1" }, tok2: { _id: "p2" }, tok3: { _id: "p3" } })[token] || null,
			},
			subscriptions: {
				findById: async (id) =>
					({
						[subscriptionId]: { _id: subscriptionId, projectId: "p1", secret: "sec" },
						[otherProjectSubscriptionId]: { _id: otherProjectSubscriptionId, projectId: "p2", secret: "sec2" },
						[rateSubscriptionId]: { _id: rateSubscriptionId, projectId: "p3", secret: "sec3" },
					})[id] || null,
			},
			receipts: { record },
			now: () => clock,
		}),
	);
	app.use(express.json({ limit: "200kb" }));
	app.post("/api/v1/echo", (request, response) => response.json({ data: request.body }));
	app.use(notFoundHandler);
	app.use(errorHandler);
	server = app.listen(0, "127.0.0.1");
	await new Promise((resolve) => server.once("listening", resolve));
	base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
afterAll(() => server.close());
const post = (body, headers = {}, token = "tok1") =>
	fetch(`${base}/webhook-sink/${token}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
const signed = (body, deliveryId, ts = Math.floor(clock / 1000)) => ({
	"x-rheostat-subscription": subscriptionId,
	"x-rheostat-delivery": deliveryId,
	"x-rheostat-event": "flag.archived",
	"x-rheostat-signature": sign("sec", body, ts),
});

describe("webhook sink over HTTP", () => {
	test("accepts a body signed over the exact bytes (whitespace preserved) → 204, receipt valid", async () => {
		const body = '{ "id": "1",  "n": 1.10 }';
		const response = await post(body, signed(body, "d1"));
		expect(response.status).toBe(204);
		expect(state.receipts.at(-1)).toMatchObject({ signatureValid: true, receivedCount: 1, body });
	});
	test("a duplicate valid delivery is still 204 and counted on the same receipt; concurrent duplicates yield one document", async () => {
		const body = '{"id":"1"}';
		await post(body, signed(body, "d2"));
		const again = await post(body, signed(body, "d2"));
		expect(again.status).toBe(204);
		expect(again.headers.get("x-rheostat-received-count")).toBe("2");
		expect(state.receipts.filter((r) => r.dedupeKey === "d2")).toHaveLength(1);
		const burst = await Promise.all(Array.from({ length: 5 }, () => post(body, signed(body, "d2-burst"))));
		expect(burst.every((r) => r.status === 204)).toBe(true);
		const docs = state.receipts.filter((r) => r.dedupeKey === "d2-burst");
		expect(docs).toHaveLength(1);
		expect(docs[0].receivedCount).toBe(5);
	});
	test("a Project B subscription with a valid Project B signature is rejected on Project A's sink", async () => {
		const body = '{"id":"cross"}';
		const headers = {
			"x-rheostat-subscription": otherProjectSubscriptionId,
			"x-rheostat-delivery": "cross-1",
			"x-rheostat-event": "flag.archived",
			"x-rheostat-signature": sign("sec2", body, Math.floor(clock / 1000)),
		};
		const onOwnSink = await post(body, headers, "tok2");
		expect(onOwnSink.status).toBe(204);
		const onOtherSink = await post(body, headers, "tok1");
		expect(onOtherSink.status).toBe(401);
		expect((await onOtherSink.json()).error.details.reason).toBe("unknown subscription");
		expect(state.receipts.at(-1)).toMatchObject({ projectId: "p1", signatureValid: false, subscriptionId: null });
	});
	test("mismatch, expired, malformed, unknown subscription → 401 SIGNATURE_INVALID with the reason; receipts recorded", async () => {
		const body = '{"id":"3"}';
		const mismatch = await post(body, { ...signed(body, "d3"), "x-rheostat-signature": sign("wrong", body, Math.floor(clock / 1000)) });
		expect(mismatch.status).toBe(401);
		expect((await mismatch.json()).error).toMatchObject({ code: "SIGNATURE_INVALID", details: { reason: "mismatch" } });
		const expired = await post(body, signed(body, "d4", Math.floor(clock / 1000) - 301));
		expect((await expired.json()).error.details.reason).toBe("expired");
		const malformed = await post(body, { ...signed(body, "d5"), "x-rheostat-signature": "nope" });
		expect((await malformed.json()).error.details.reason).toBe("malformed");
		const unknown = await post(body, { ...signed(body, "d6"), "x-rheostat-subscription": new mongoose.Types.ObjectId().toString() });
		expect((await unknown.json()).error.details.reason).toBe("unknown subscription");
		// Four invalid receipts for this body; the cross-project case above recorded its own invalid receipt on p1.
		expect(state.receipts.filter((r) => !r.signatureValid && r.body === body)).toHaveLength(4);
	});
	test("unknown token → 404; body over 16 kB → 413 with a request id; global JSON parsing is unaffected", async () => {
		expect((await post("{}", {}, "nope")).status).toBe(404);
		const big = JSON.stringify({ pad: "x".repeat(17 * 1024) });
		const tooBig = await post(big, signed(big, "d7"));
		expect(tooBig.status).toBe(413);
		expect((await tooBig.json()).error.requestId).toBeTruthy();
		const echo = await fetch(`${base}/echo`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"a":1}' });
		expect((await echo.json()).data).toEqual({ a: 1 });
	});
	test("rate limit: the 121st request in a minute → 429", async () => {
		// The limit is per token, so a token no earlier test touched gives a deterministic count.
		const body = '{"id":"r"}';
		const headers = (id) => ({
			...signed(body, id),
			"x-rheostat-subscription": rateSubscriptionId,
			"x-rheostat-signature": sign("sec3", body, Math.floor(clock / 1000)),
		});
		let last;
		for (let index = 0; index < 120; index += 1) last = await post(body, headers(`r${index}`), "tok3");
		expect(last.status).toBe(204);
		const limited = await post(body, headers("r-final"), "tok3");
		expect(limited.status).toBe(429);
		expect((await limited.json()).error.code).toBe("RATE_LIMITED");
	});
});
