import { createHmac, timingSafeEqual } from "node:crypto";

// Stripe-style: HMAC-SHA256 over "<timestamp>.<body>" as "t=<ts>,v1=<hex>". The timestamp lets a receiver
// reject replays; the constant-time compare avoids timing leaks.
const digest = (secret, body, timestamp) => createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

export const sign = (secret, body, timestampSeconds) => `t=${timestampSeconds},v1=${digest(secret, body, timestampSeconds)}`;

export function verify(secret, body, header, { nowSeconds, toleranceSeconds = 300 }) {
	const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header || "");
	if (!match) return { valid: false, error: "malformed" };
	const timestamp = Number(match[1]);
	if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return { valid: false, error: "expired" };
	const expected = Buffer.from(digest(secret, body, timestamp), "hex");
	const received = Buffer.from(match[2], "hex");
	if (expected.length !== received.length || !timingSafeEqual(expected, received)) return { valid: false, error: "mismatch" };
	return { valid: true };
}
