import { afterAll, beforeAll, describe, expect, test } from "bun:test";

process.env.MONGODB_URI = "mongodb://localhost:27017/rheostat_test";
process.env.JWT_SECRET = "test-secret";
const { initConfig } = await import("../config/index.js");
initConfig();
const { createApp } = await import("../../app.js");

let server;
let base;
beforeAll(async () => {
	server = createApp().listen(0, "127.0.0.1");
	await new Promise((resolve) => server.once("listening", resolve));
	base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server.close());

describe("error envelopes carry a request id", () => {
	test("malformed JSON → 400 INVALID_JSON with the echoed request id", async () => {
		const response = await fetch(`${base}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-request-id": "trace-00001234" }, body: "{not json" });
		expect(response.status).toBe(400);
		expect(response.headers.get("x-request-id")).toBe("trace-00001234");
		const body = await response.json();
		expect(body.error).toMatchObject({ code: "INVALID_JSON", requestId: "trace-00001234" });
	});
	test("oversized JSON → 413 PAYLOAD_TOO_LARGE with a generated request id", async () => {
		const response = await fetch(`${base}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pad: "x".repeat(210 * 1024) }) });
		expect(response.status).toBe(413);
		const body = await response.json();
		expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
		expect(body.error.requestId).toMatch(/^[0-9a-f-]{36}$/);
		expect(response.headers.get("x-request-id")).toBe(body.error.requestId);
	});
	test("unknown route → 404 with request id", async () => {
		// `/api/v1/*` sits behind the workspace auth wall, so the unknown-route case is exercised outside it.
		const response = await fetch(`${base}/api/nope`);
		expect(response.status).toBe(404);
		expect((await response.json()).error.requestId).toBeTruthy();
	});
	test("auth wall → 401 with request id", async () => {
		const response = await fetch(`${base}/api/v1/nope`);
		expect(response.status).toBe(401);
		expect((await response.json()).error.requestId).toBe(response.headers.get("x-request-id"));
	});
});
