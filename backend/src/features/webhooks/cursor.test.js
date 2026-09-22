import { describe, expect, test } from "bun:test";
import { cursorPredicate, decodeCursor, encodeCursor } from "./cursor.js";

describe("compound cursor", () => {
	test("round-trips createdAt and id", () => {
		const cursor = encodeCursor({ createdAt: new Date("2026-09-21T10:00:00.000Z"), _id: "6aae6f0f24551d7c9a1f37a5" });
		expect(decodeCursor(cursor)).toEqual({ createdAt: new Date("2026-09-21T10:00:00.000Z"), id: "6aae6f0f24551d7c9a1f37a5" });
	});
	test("rejects garbage", () => {
		expect(decodeCursor("nope")).toBeNull();
		expect(decodeCursor("2026-09-21T10:00:00.000Z_zzz")).toBeNull();
	});
	test("predicate orders by createdAt then _id", () => {
		const predicate = cursorPredicate({ createdAt: new Date("2026-09-21T10:00:00.000Z"), id: "6aae6f0f24551d7c9a1f37a5" });
		expect(predicate).toEqual({
			$or: [{ createdAt: { $lt: new Date("2026-09-21T10:00:00.000Z") } }, { createdAt: new Date("2026-09-21T10:00:00.000Z"), _id: { $lt: "6aae6f0f24551d7c9a1f37a5" } }],
		});
	});
});
