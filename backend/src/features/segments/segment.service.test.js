import { describe, expect, test } from "bun:test";
import { assertFlatRules, assertRemovable, referencesFor, withRuleIds } from "./segment.service.js";

describe("segment guards", () => {
	test("accepts flat rules", () => {
		expect(() => assertFlatRules([{ clauses: [{ attribute: "plan", operator: "in", values: ["pro"] }] }])).not.toThrow();
		expect(() => assertFlatRules([])).not.toThrow();
	});

	test("rejects nested segment references with 422 INVALID_CONFIG", () => {
		try {
			assertFlatRules([{ clauses: [{ attribute: "key", operator: "segmentMatch", values: ["beta-testers"] }] }]);
			throw new Error("expected to throw");
		} catch (error) {
			expect(error.statusCode).toBe(422);
			expect(error.code).toBe("INVALID_CONFIG");
			expect(error.details.issues).toEqual(["Segments cannot reference segments."]);
		}
	});

	test("assertRemovable allows unreferenced segments and blocks referenced ones", () => {
		expect(() => assertRemovable(0, "eu-users")).not.toThrow();
		try {
			assertRemovable(3, "eu-users");
			throw new Error("expected to throw");
		} catch (error) {
			expect(error.statusCode).toBe(409);
			expect(error.code).toBe("SEGMENT_IN_USE");
			expect(error.details.referencingFlags).toBe(3);
		}
	});

	test("withRuleIds preserves existing ids and assigns new ones", () => {
		const rules = withRuleIds([{ id: "sr_keep", clauses: [] }, { clauses: [] }]);
		expect(rules[0].id).toBe("sr_keep");
		expect(rules[1].id).toMatch(/^sr_[a-f0-9]{8}$/);
	});

	test("referencesFor lists the flags and environments that use a segment", () => {
		const clause = (segment) => ({ attribute: "key", operator: "segmentMatch", values: [segment] });
		const flags = [
			{
				key: "a",
				name: "A",
				archived: false,
				environments: { development: { rules: [{ clauses: [clause("eu")] }] }, production: { rules: [] } },
			},
			{ key: "b", name: "B", archived: true, environments: { production: { rules: [{ clauses: [clause("eu"), clause("beta")] }] } } },
			{
				key: "c",
				name: "C",
				archived: false,
				environments: { staging: { rules: [{ clauses: [{ attribute: "plan", operator: "in", values: ["eu"] }] }] } },
			},
		];
		expect(referencesFor("eu", flags)).toEqual([
			{ key: "a", name: "A", archived: false, environments: ["development"] },
			{ key: "b", name: "B", archived: true, environments: ["production"] },
		]);
		expect(referencesFor("nope", flags)).toEqual([]);
	});
});
