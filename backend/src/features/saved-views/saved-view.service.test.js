import { describe, expect, test } from "bun:test";
import { assertOwner, normalizeFilters } from "./saved-view.service.js";

describe("saved view guards", () => {
	test("assertOwner allows the owner and rejects everyone else with 403", () => {
		const view = { ownerId: "64b000000000000000000001" };
		expect(() => assertOwner(view, { _id: "64b000000000000000000001" })).not.toThrow();
		try {
			assertOwner(view, { _id: "64b000000000000000000002", role: "admin" });
			throw new Error("expected to throw");
		} catch (error) {
			expect(error.statusCode).toBe(403);
			expect(error.code).toBe("FORBIDDEN");
		}
	});

	test("normalizeFilters drops defaults and empty values, keeps tags as a sorted unique list", () => {
		expect(
			normalizeFilters({ query: "  ", type: "", stale: "any", state: "any", environment: "", archived: false, tags: ["b", "a", "b"] }),
		).toEqual({ tags: ["a", "b"] });
		expect(normalizeFilters({ query: "check", environment: "production", state: "on", stale: "overdue", archived: true })).toEqual({
			query: "check",
			environment: "production",
			state: "on",
			stale: "overdue",
			archived: true,
		});
	});

	test("normalizeFilters ignores state without an environment", () => {
		expect(normalizeFilters({ state: "on" })).toEqual({});
	});
});
