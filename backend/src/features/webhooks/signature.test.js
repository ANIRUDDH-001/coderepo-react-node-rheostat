import { describe, expect, test } from "bun:test";
import { sign, verify } from "./signature.js";

describe("webhook signature", () => {
	const secret = "s3cret";
	const body = '{"id":"1"}';
	test("round-trips", () => {
		const header = sign(secret, body, 1700000000);
		expect(header).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);
		expect(verify(secret, body, header, { nowSeconds: 1700000010 })).toEqual({ valid: true });
	});
	test("rejects a mismatched secret or body", () => {
		const header = sign(secret, body, 1700000000);
		expect(verify("other", body, header, { nowSeconds: 1700000010 })).toEqual({ valid: false, error: "mismatch" });
		expect(verify(secret, '{"id":"2"}', header, { nowSeconds: 1700000010 })).toEqual({ valid: false, error: "mismatch" });
	});
	test("rejects stale timestamps and malformed headers", () => {
		const header = sign(secret, body, 1700000000);
		expect(verify(secret, body, header, { nowSeconds: 1700000301 })).toEqual({ valid: false, error: "expired" });
		expect(verify(secret, body, "nope", { nowSeconds: 1 })).toEqual({ valid: false, error: "malformed" });
		expect(verify(secret, body, undefined, { nowSeconds: 1 })).toEqual({ valid: false, error: "malformed" });
	});
});
