import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { createRequestContext } from "./request-context.js";

const fakeResponse = () => {
	const response = new EventEmitter();
	response.headers = {};
	response.statusCode = 200;
	response.setHeader = (name, value) => {
		response.headers[name.toLowerCase()] = value;
	};
	return response;
};
const fakeRequest = (headers = {}) => ({ method: "GET", originalUrl: "/api/v1/projects?x=1", get: (name) => headers[name.toLowerCase()] });

describe("requestContext", () => {
	test("assigns a uuid when no header is present, echoes it, and logs on finish", () => {
		const lines = [];
		const middleware = createRequestContext({ log: { info: (event, fields) => lines.push({ event, ...fields }) } });
		const request = fakeRequest();
		const response = fakeResponse();
		middleware(request, response, () => {});
		expect(request.id).toMatch(/^[0-9a-f-]{36}$/);
		expect(response.headers["x-request-id"]).toBe(request.id);
		response.emit("finish");
		expect(lines[0]).toMatchObject({ event: "http.request", requestId: request.id, method: "GET", path: "/api/v1/projects", status: 200 });
		expect(typeof lines[0].durationMs).toBe("number");
	});
	test("accepts a well-formed client id and replaces a malformed one", () => {
		const middleware = createRequestContext({ log: { info: () => {} } });
		const good = fakeRequest({ "x-request-id": "client-abc12345" });
		middleware(good, fakeResponse(), () => {});
		expect(good.id).toBe("client-abc12345");
		const bad = fakeRequest({ "x-request-id": "no spaces allowed!" });
		middleware(bad, fakeResponse(), () => {});
		expect(bad.id).toMatch(/^[0-9a-f-]{36}$/);
	});
	test("includes account and profile ids set later by the auth middlewares", () => {
		const lines = [];
		const middleware = createRequestContext({ log: { info: (event, fields) => lines.push(fields) } });
		const request = fakeRequest();
		const response = fakeResponse();
		middleware(request, response, () => {});
		request.account = { _id: "acc1" };
		request.profileId = "prof1";
		response.emit("finish");
		expect(lines[0]).toMatchObject({ accountId: "acc1", profileId: "prof1" });
	});
});
