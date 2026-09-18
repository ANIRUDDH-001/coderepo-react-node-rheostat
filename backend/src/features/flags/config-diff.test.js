import { describe, expect, test } from "bun:test";
import { diffEnvConfig, isEquivalent, normalizeConfig } from "./config-diff.js";

const rule = (id, values, serve = { variationId: "v_on" }) => ({
	id,
	description: `Rule ${id}`,
	clauses: [{ attribute: "plan", operator: "in", values, negate: false }],
	serve,
});
const base = () => ({
	version: 4,
	enabled: true,
	offVariationId: "v_off",
	rules: [rule("r1", ["pro"])],
	fallthrough: { variationId: "v_on" },
	lastEffectiveChangeAt: new Date("2026-09-01T00:00:00Z"),
	lastChangedBy: "abc",
});

describe("normalizeConfig", () => {
	test("strips bookkeeping fields and Mongoose ids, keeps decision fields", () => {
		const normalized = normalizeConfig({ ...base(), _id: "x", rules: [{ ...rule("r1", ["pro"]), _id: "y", clauses: [{ _id: "z", attribute: "plan", operator: "in", values: ["pro"], negate: false }] }] });
		expect(normalized).toEqual({
			enabled: true,
			offVariationId: "v_off",
			rules: [{ id: "r1", description: "Rule r1", clauses: [{ attribute: "plan", operator: "in", values: ["pro"], negate: false }], serve: { variationId: "v_on" } }],
			fallthrough: { variationId: "v_on" },
		});
	});
});

describe("diffEnvConfig", () => {
	test("identical configs produce no entries", () => {
		expect(diffEnvConfig(base(), base())).toEqual([]);
		expect(isEquivalent(base(), { ...base(), version: 9, lastChangedBy: "someone-else" })).toBe(true);
	});

	test("enabled change", () => {
		expect(diffEnvConfig(base(), { ...base(), enabled: false })).toEqual([{ path: "enabled", kind: "changed", before: true, after: false }]);
	});

	test("off variation change", () => {
		expect(diffEnvConfig(base(), { ...base(), offVariationId: "v_on" })).toEqual([{ path: "offVariationId", kind: "changed", before: "v_off", after: "v_on" }]);
	});

	test("rule added and removed", () => {
		const added = diffEnvConfig(base(), { ...base(), rules: [rule("r1", ["pro"]), rule("r9", ["free"])] });
		expect(added).toEqual([{ path: "rules.r9", kind: "added", before: null, after: normalizeConfig({ ...base(), rules: [rule("r9", ["free"])] }).rules[0] }]);
		const removed = diffEnvConfig(base(), { ...base(), rules: [] });
		expect(removed).toEqual([{ path: "rules.r1", kind: "removed", before: normalizeConfig(base()).rules[0], after: null }]);
	});

	test("clause value change is reported at clause level", () => {
		const after = { ...base(), rules: [rule("r1", ["pro", "enterprise"])] };
		expect(diffEnvConfig(base(), after)).toEqual([{ path: "rules.r1.clauses.0.values", kind: "changed", before: ["pro"], after: ["pro", "enterprise"] }]);
	});

	test("rule serve change and description change", () => {
		const after = { ...base(), rules: [{ ...rule("r1", ["pro"], { variationId: "v_off" }), description: "Renamed" }] };
		expect(diffEnvConfig(base(), after)).toEqual([
			{ path: "rules.r1.description", kind: "changed", before: "Rule r1", after: "Renamed" },
			{ path: "rules.r1.serve", kind: "changed", before: { variationId: "v_on" }, after: { variationId: "v_off" } },
		]);
	});

	test("fallthrough fixed to rollout", () => {
		const rollout = { rollout: { bucketBy: "key", weights: [{ variationId: "v_on", weight: 25000 }, { variationId: "v_off", weight: 75000 }] } };
		expect(diffEnvConfig(base(), { ...base(), fallthrough: rollout })).toEqual([{ path: "fallthrough", kind: "changed", before: { variationId: "v_on" }, after: rollout }]);
	});

	test("rule reorder is a single order change", () => {
		const before = { ...base(), rules: [rule("r1", ["pro"]), rule("r2", ["free"])] };
		const after = { ...base(), rules: [rule("r2", ["free"]), rule("r1", ["pro"])] };
		expect(diffEnvConfig(before, after)).toEqual([{ path: "rules.order", kind: "changed", before: ["r1", "r2"], after: ["r2", "r1"] }]);
	});

	test("ordering is deterministic regardless of key insertion order", () => {
		const shuffled = { fallthrough: { variationId: "v_off" }, rules: [], offVariationId: "v_on", enabled: false };
		const first = diffEnvConfig(base(), shuffled);
		const second = diffEnvConfig(base(), { enabled: false, offVariationId: "v_on", rules: [], fallthrough: { variationId: "v_off" } });
		expect(first).toEqual(second);
		expect(first.map((entry) => entry.path)).toEqual(["enabled", "offVariationId", "rules.r1", "fallthrough"]);
	});
});
