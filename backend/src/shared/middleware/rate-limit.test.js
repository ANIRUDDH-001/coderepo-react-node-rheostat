import { describe, expect, test } from "bun:test";
import { createRateLimiter } from "./rate-limit.js";

const run = (middleware, key = "a") => {
	const request = { ip: "1.1.1.1", body: {}, rateKey: key };
	const response = { headers: {}, setHeader(name, value) { this.headers[name] = value; } };
	let error = null;
	middleware(request, response, (caught) => { error = caught || null; });
	return { response, error };
};

describe("createRateLimiter", () => {
	test("allows max requests per window, then 429 with headers, then resets", () => {
		let clock = 1000;
		const limiter = createRateLimiter({ name: "t", windowMs: 60000, max: 2, keyFor: (request) => request.rateKey, now: () => clock });
		expect(run(limiter).error).toBeNull();
		const second = run(limiter);
		expect(second.error).toBeNull();
		expect(second.response.headers["RateLimit-Remaining"]).toBe(0);
		const third = run(limiter);
		expect(third.error.statusCode).toBe(429);
		expect(third.error.code).toBe("RATE_LIMITED");
		expect(third.error.details).toEqual({ retryAfterSeconds: 60, limit: 2 });
		expect(third.response.headers["Retry-After"]).toBe(60);
		clock += 60001;
		expect(run(limiter).error).toBeNull();
	});
	test("keys are independent", () => {
		const limiter = createRateLimiter({ name: "t", windowMs: 60000, max: 1, keyFor: (request) => request.rateKey });
		expect(run(limiter, "a").error).toBeNull();
		expect(run(limiter, "b").error).toBeNull();
		expect(run(limiter, "a").error.statusCode).toBe(429);
	});
	test("reset clears the store", () => {
		const limiter = createRateLimiter({ name: "t", windowMs: 60000, max: 1, keyFor: (request) => request.rateKey });
		run(limiter);
		limiter.reset();
		expect(run(limiter).error).toBeNull();
	});
});
