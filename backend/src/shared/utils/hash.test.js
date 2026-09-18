import { describe, expect, test } from "bun:test";
import { BUCKET_SPACE, bucketFor } from "./hash.js";

describe("bucketFor", () => {
	test("is deterministic and in range", () => {
		const bucket = bucketFor("checkout-v2", "production", "user-1");
		expect(bucket).toBe(bucketFor("checkout-v2", "production", "user-1"));
		expect(bucket).toBeGreaterThanOrEqual(0);
		expect(bucket).toBeLessThan(BUCKET_SPACE);
	});

	test("changes with the flag key and the environment", () => {
		const base = bucketFor("checkout-v2", "production", "user-1");
		expect(bucketFor("checkout-v3", "production", "user-1")).not.toBe(base);
		expect(bucketFor("checkout-v2", "staging", "user-1")).not.toBe(base);
	});

	test("distribution over 10000 keys is roughly uniform", () => {
		let below = 0;
		for (let index = 0; index < 10000; index += 1) if (bucketFor("f", "e", `k${index}`) < BUCKET_SPACE / 4) below += 1;
		expect(below).toBeGreaterThan(2300);
		expect(below).toBeLessThan(2700);
	});

	test("coerces non-string values", () => {
		expect(bucketFor("f", "e", 42)).toBe(bucketFor("f", "e", "42"));
	});
});
