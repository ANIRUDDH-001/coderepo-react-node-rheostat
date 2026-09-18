import { describe, expect, test } from "bun:test";
import { bucketFor } from "../../shared/utils/hash.js";
import { evaluate, isSegmentMember, matchesClause } from "./evaluator.js";

const boolFlag = (overrides = {}, flagOverrides = {}) => ({
	key: "new-checkout",
	type: "boolean",
	killSwitch: { active: false },
	variations: [
		{ id: "v_on", name: "On", value: true },
		{ id: "v_off", name: "Off", value: false },
	],
	environments: {
		production: { enabled: true, offVariationId: "v_off", rules: [], fallthrough: { variationId: "v_on" }, ...overrides },
	},
	...flagOverrides,
});
const ctx = (key, attributes = {}) => ({ key, attributes });
const clause = (attribute, operator, values, negate = false) => ({ attribute, operator, values, negate });

describe("evaluate precedence", () => {
	test("kill switch wins over everything", () => {
		const flag = boolFlag({ rules: [{ id: "r1", clauses: [clause("plan", "in", ["pro"])], serve: { variationId: "v_on" } }] }, { killSwitch: { active: true } });
		expect(evaluate(flag, "production", ctx("u1", { plan: "pro" }), {})).toMatchObject({
			variationId: "v_off",
			value: false,
			reason: { kind: "KILL_SWITCH" },
		});
	});

	test("disabled serves the off variation", () => {
		const result = evaluate(boolFlag({ enabled: false }), "production", ctx("u1"), {});
		expect(result).toMatchObject({ variationId: "v_off", value: false, reason: { kind: "OFF" } });
	});

	test("first matching rule wins and reports rule id and index", () => {
		const flag = boolFlag({
			rules: [
				{ id: "r1", clauses: [clause("plan", "in", ["enterprise"])], serve: { variationId: "v_off" } },
				{ id: "r2", clauses: [clause("country", "in", ["DE"])], serve: { variationId: "v_on" } },
			],
		});
		const result = evaluate(flag, "production", ctx("u1", { plan: "enterprise", country: "DE" }), {});
		expect(result).toMatchObject({ variationId: "v_off", reason: { kind: "RULE_MATCH", ruleId: "r1", ruleIndex: 0 } });
		expect(evaluate(flag, "production", ctx("u2", { plan: "free", country: "DE" }), {}).reason).toMatchObject({ ruleId: "r2", ruleIndex: 1 });
	});

	test("falls through when no rule matches", () => {
		const flag = boolFlag({ rules: [{ id: "r1", clauses: [clause("plan", "in", ["enterprise"])], serve: { variationId: "v_off" } }] });
		expect(evaluate(flag, "production", ctx("u1", { plan: "free" }), {})).toMatchObject({ variationId: "v_on", reason: { kind: "FALLTHROUGH" } });
	});

	test("a rule needs every clause to match", () => {
		const flag = boolFlag({
			rules: [{ id: "r1", clauses: [clause("plan", "in", ["pro"]), clause("country", "in", ["DE"])], serve: { variationId: "v_off" } }],
		});
		expect(evaluate(flag, "production", ctx("u1", { plan: "pro", country: "FR" }), {}).reason.kind).toBe("FALLTHROUGH");
		expect(evaluate(flag, "production", ctx("u1", { plan: "pro", country: "DE" }), {}).reason.kind).toBe("RULE_MATCH");
	});

	test("unknown environment evaluates as off", () => {
		expect(evaluate(boolFlag(), "staging", ctx("u1"), {})).toMatchObject({ variationId: "v_off", reason: { kind: "OFF" } });
	});
});

describe("clauses", () => {
	test("missing attribute never matches, even when negated", () => {
		const negated = clause("plan", "in", ["pro"], true);
		expect(matchesClause(negated, ctx("u1", {}), {})).toBe(false);
		expect(matchesClause(negated, ctx("u1", { plan: "free" }), {})).toBe(true);
		expect(matchesClause(negated, ctx("u1", { plan: "pro" }), {})).toBe(false);
	});

	test("the context key is readable as the key attribute", () => {
		expect(matchesClause(clause("key", "in", ["u-42"]), ctx("u-42"), {})).toBe(true);
	});

	test.each([
		["in", "plan", ["pro", "enterprise"], { plan: "enterprise" }, true],
		["in", "plan", ["pro"], { plan: "free" }, false],
		["in", "betaOptIn", ["true"], { betaOptIn: true }, true],
		["contains", "appVersion", ["beta"], { appVersion: "4.2.0-beta" }, true],
		["contains", "appVersion", ["beta"], { appVersion: "4.2.0" }, false],
		["startsWith", "email", ["ops@"], { email: "ops@rheostat.team" }, true],
		["endsWith", "email", ["@rheostat.team"], { email: "sam@rheostat.team" }, true],
		["endsWith", "email", ["@rheostat.team"], { email: "sam@example.com" }, false],
		["greaterThan", "sessions", ["10"], { sessions: 12 }, true],
		["greaterThan", "sessions", ["10"], { sessions: 10 }, false],
		["greaterThan", "sessions", ["10"], { sessions: "many" }, false],
		["lessThan", "sessions", ["10"], { sessions: 3 }, true],
		["lessThan", "sessions", ["ten"], { sessions: 3 }, false],
		["before", "signupDate", ["2026-01-01"], { signupDate: "2025-12-31" }, true],
		["before", "signupDate", ["2026-01-01"], { signupDate: "2026-01-01" }, false],
		["after", "signupDate", ["2026-01-01"], { signupDate: "2026-02-01" }, true],
		["after", "signupDate", ["2026-01-01"], { signupDate: "not-a-date" }, false],
		["unknownOperator", "plan", ["pro"], { plan: "pro" }, false],
	])("%s on %s", (operator, attribute, values, attributes, expected) => {
		expect(matchesClause(clause(attribute, operator, values), ctx("u", attributes), {})).toBe(expected);
	});
});

describe("segments", () => {
	const segment = {
		key: "beta",
		includedKeys: ["u-in"],
		excludedKeys: ["u-out"],
		rules: [{ clauses: [clause("betaOptIn", "in", ["true"])] }],
	};
	const segments = { beta: segment };

	test("excluded beats included beats rules", () => {
		expect(isSegmentMember({ ...segment, includedKeys: ["u-out"] }, ctx("u-out", { betaOptIn: true }))).toBe(false);
		expect(isSegmentMember(segment, ctx("u-in"))).toBe(true);
		expect(isSegmentMember(segment, ctx("u-x", { betaOptIn: true }))).toBe(true);
		expect(isSegmentMember(segment, ctx("u-y"))).toBe(false);
	});

	test("segmentMatch clause resolves by key and ignores unknown segments", () => {
		const match = clause("key", "segmentMatch", ["beta"]);
		expect(matchesClause(match, ctx("u-in"), segments)).toBe(true);
		expect(matchesClause(match, ctx("u-y"), segments)).toBe(false);
		expect(matchesClause(clause("key", "segmentMatch", ["missing"]), ctx("u-in"), segments)).toBe(false);
		expect(matchesClause(clause("key", "segmentMatch", ["missing", "beta"]), ctx("u-in"), segments)).toBe(true);
	});

	test("negated segmentMatch inverts membership", () => {
		expect(matchesClause(clause("key", "segmentMatch", ["beta"], true), ctx("u-y"), segments)).toBe(true);
		expect(matchesClause(clause("key", "segmentMatch", ["beta"], true), ctx("u-in"), segments)).toBe(false);
	});
});

describe("rollouts", () => {
	const split = (on) => ({
		rollout: {
			bucketBy: "key",
			weights: [
				{ variationId: "v_on", weight: on },
				{ variationId: "v_off", weight: 100000 - on },
			],
		},
	});

	test("fallthrough rollout is sticky and roughly proportional", () => {
		const flag = boolFlag({ fallthrough: split(30000) });
		const first = evaluate(flag, "production", ctx("u7"), {});
		expect(evaluate(flag, "production", ctx("u7"), {})).toEqual(first);
		expect(first.reason).toMatchObject({ kind: "FALLTHROUGH", bucket: expect.any(Number) });
		let on = 0;
		for (let index = 0; index < 5000; index += 1) if (evaluate(flag, "production", ctx(`u${index}`), {}).variationId === "v_on") on += 1;
		expect(on / 5000).toBeGreaterThan(0.27);
		expect(on / 5000).toBeLessThan(0.33);
	});

	test("bucket boundaries: 0% never serves, 100% always serves", () => {
		for (let index = 0; index < 200; index += 1) {
			expect(evaluate(boolFlag({ fallthrough: split(0) }), "production", ctx(`u${index}`), {}).variationId).toBe("v_off");
			expect(evaluate(boolFlag({ fallthrough: split(100000) }), "production", ctx(`u${index}`), {}).variationId).toBe("v_on");
		}
	});

	test("bucketBy uses the named attribute and falls back to the key", () => {
		const flag = boolFlag({
			fallthrough: {
				rollout: {
					bucketBy: "company",
					weights: [
						{ variationId: "v_on", weight: 50000 },
						{ variationId: "v_off", weight: 50000 },
					],
				},
			},
		});
		expect(evaluate(flag, "production", ctx("u1", { company: "acme" }), {}).reason.bucket).toBe(bucketFor("new-checkout", "production", "acme"));
		expect(evaluate(flag, "production", ctx("u1"), {}).reason.bucket).toBe(bucketFor("new-checkout", "production", "u1"));
	});

	test("multivariate three-way split resolves value by bucket range", () => {
		const flag = {
			key: "checkout-layout",
			type: "string",
			killSwitch: { active: false },
			variations: [
				{ id: "v_control", value: "control" },
				{ id: "v_compact", value: "compact" },
				{ id: "v_express", value: "express" },
			],
			environments: {
				production: {
					enabled: true,
					offVariationId: "v_control",
					rules: [],
					fallthrough: {
						rollout: {
							bucketBy: "key",
							weights: [
								{ variationId: "v_control", weight: 50000 },
								{ variationId: "v_compact", weight: 30000 },
								{ variationId: "v_express", weight: 20000 },
							],
						},
					},
				},
			},
		};
		const expectedFor = (bucket) => (bucket < 50000 ? "control" : bucket < 80000 ? "compact" : "express");
		const seen = new Set();
		for (let index = 0; index < 2000; index += 1) {
			const key = `member-${index}`;
			const bucket = bucketFor("checkout-layout", "production", key);
			const result = evaluate(flag, "production", ctx(key), {});
			expect(result.value).toBe(expectedFor(bucket));
			expect(result.reason.bucket).toBe(bucket);
			seen.add(result.value);
		}
		expect([...seen].sort()).toEqual(["compact", "control", "express"]);
	});

	test("a rule may serve a rollout: rule precedence plus bucketing", () => {
		const flag = boolFlag({
			rules: [{ id: "r-beta", clauses: [clause("betaOptIn", "in", ["true"])], serve: split(50000) }],
			fallthrough: { variationId: "v_off" },
		});
		const beta = evaluate(flag, "production", ctx("u-beta", { betaOptIn: true }), {});
		expect(beta.reason).toMatchObject({ kind: "RULE_MATCH", ruleId: "r-beta", bucket: bucketFor("new-checkout", "production", "u-beta") });
		expect(beta.variationId).toBe(beta.reason.bucket < 50000 ? "v_on" : "v_off");
		expect(evaluate(flag, "production", ctx("u-beta", { betaOptIn: true }), {})).toEqual(beta);
		expect(evaluate(flag, "production", ctx("u-plain"), {})).toMatchObject({ variationId: "v_off", reason: { kind: "FALLTHROUGH" } });
	});

	test("serving an unknown variation falls back to the off variation with an error reason", () => {
		const flag = boolFlag({ fallthrough: { variationId: "v_missing" } });
		expect(evaluate(flag, "production", ctx("u1"), {})).toMatchObject({ variationId: "v_off", reason: { kind: "ERROR" } });
	});
});
