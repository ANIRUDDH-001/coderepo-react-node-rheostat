import { describe, expect, test } from "bun:test";
import { validateEnvConfig } from "./config-validation.js";
import { initialConfig, variationValueSchema } from "./env-config.js";

const flag = {
	key: "checkout-layout",
	type: "string",
	variations: [
		{ id: "v_a", value: "a" },
		{ id: "v_b", value: "b" },
		{ id: "v_c", value: "c" },
	],
};
const segmentKeys = new Set(["beta", "eu"]);
const ok = () => ({
	enabled: true,
	offVariationId: "v_a",
	rules: [{ id: "r1", description: "", clauses: [{ attribute: "plan", operator: "in", values: ["pro"], negate: false }], serve: { variationId: "v_b" } }],
	fallthrough: { rollout: { bucketBy: "key", weights: [{ variationId: "v_a", weight: 60000 }, { variationId: "v_b", weight: 40000 }] } },
});
const issuesOf = (config) => {
	try {
		validateEnvConfig(config, flag, segmentKeys);
		return [];
	} catch (error) {
		expect(error.statusCode).toBe(422);
		expect(error.code).toBe("INVALID_CONFIG");
		return error.details.issues;
	}
};

describe("validateEnvConfig", () => {
	test("accepts a valid config", () => {
		expect(issuesOf(ok())).toEqual([]);
	});
	test("rejects unknown variation ids everywhere they can appear", () => {
		expect(issuesOf({ ...ok(), offVariationId: "v_zz" })).toEqual([expect.stringContaining("v_zz")]);
		expect(issuesOf({ ...ok(), rules: [{ ...ok().rules[0], serve: { variationId: "v_zz" } }] })).toEqual([expect.stringContaining("v_zz")]);
		expect(issuesOf({ ...ok(), fallthrough: { rollout: { bucketBy: "key", weights: [{ variationId: "v_zz", weight: 100000 }] } } })).toEqual([expect.stringContaining("v_zz")]);
	});
	test("weights must sum to exactly 100000 and not repeat a variation", () => {
		expect(issuesOf({ ...ok(), fallthrough: { rollout: { bucketBy: "key", weights: [{ variationId: "v_a", weight: 60000 }, { variationId: "v_b", weight: 39999 }] } } })).toEqual([expect.stringContaining("100000")]);
		expect(issuesOf({ ...ok(), fallthrough: { rollout: { bucketBy: "key", weights: [{ variationId: "v_a", weight: 50000 }, { variationId: "v_a", weight: 50000 }] } } })).toEqual([expect.stringContaining("once")]);
	});
	test("segmentMatch values must be known segment keys", () => {
		const rule = { ...ok().rules[0], clauses: [{ attribute: "key", operator: "segmentMatch", values: ["beta", "nope"], negate: false }] };
		expect(issuesOf({ ...ok(), rules: [rule] })).toEqual([expect.stringContaining("nope")]);
	});
	test("rule ids must be unique and rule count is capped", () => {
		expect(issuesOf({ ...ok(), rules: [ok().rules[0], ok().rules[0]] })).toEqual([expect.stringContaining("r1")]);
		const many = Array.from({ length: 26 }, (_, index) => ({ ...ok().rules[0], id: `r${index}` }));
		expect(issuesOf({ ...ok(), rules: many })).toEqual([expect.stringContaining("25")]);
	});
	test("reports every issue at once", () => {
		const broken = { ...ok(), offVariationId: "v_zz", fallthrough: { rollout: { bucketBy: "key", weights: [{ variationId: "v_a", weight: 1 }] } } };
		expect(issuesOf(broken)).toHaveLength(2);
	});
});

describe("initialConfig and variation values", () => {
	test("initial config is disabled, off = second variation, fallthrough = first, version 1", () => {
		expect(initialConfig(flag)).toEqual({ version: 1, enabled: false, offVariationId: "v_b", rules: [], fallthrough: { variationId: "v_a" } });
	});
	test("variation values are validated by flag type", () => {
		expect(variationValueSchema("boolean").safeParse(true).success).toBe(true);
		expect(variationValueSchema("boolean").safeParse("true").success).toBe(false);
		expect(variationValueSchema("number").safeParse(12.5).success).toBe(true);
		expect(variationValueSchema("number").safeParse("12").success).toBe(false);
		expect(variationValueSchema("string").safeParse("compact").success).toBe(true);
		expect(variationValueSchema("string").safeParse("").success).toBe(false);
		expect(variationValueSchema("json").safeParse({ banner: { text: "Sale" } }).success).toBe(true);
		expect(variationValueSchema("json").safeParse("not-json-object").success).toBe(false);
	});
});
