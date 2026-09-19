import { describe, expect, test } from "bun:test";
import { evaluate, REASONS } from "./evaluator.js";
import { attributionKey, SAMPLE_LIMIT, summarizeImpact } from "./impact.js";

const flag = (production) => ({
	key: "new-checkout",
	variations: [
		{ id: "v_true", name: "True", value: true },
		{ id: "v_false", name: "False", value: false },
	],
	killSwitch: { active: false },
	environments: { production },
});
const audience = Array.from({ length: 100 }, (_, index) => ({
	key: `user-${index}`,
	name: `User ${index}`,
	attributes: { plan: index % 4 === 0 ? "enterprise" : "free" },
}));

describe("summarizeImpact", () => {
	test("counts variations before and after and reports flips with a bounded sample", () => {
		const off = flag({ enabled: false, offVariationId: "v_false", rules: [], fallthrough: { variationId: "v_true" } });
		const on = flag({ enabled: true, offVariationId: "v_false", rules: [], fallthrough: { variationId: "v_true" } });
		const summary = summarizeImpact(
			audience,
			(context) => evaluate(off, "production", context),
			(context) => evaluate(on, "production", context),
		);
		expect(summary.audienceSize).toBe(100);
		expect(summary.before).toEqual({ v_false: 100 });
		expect(summary.after).toEqual({ v_true: 100 });
		expect(summary.flipped).toBe(100);
		expect(summary.flippedSample).toHaveLength(SAMPLE_LIMIT);
		expect(summary.flippedSample[0]).toMatchObject({
			key: "user-0",
			before: { variationId: "v_false" },
			after: { variationId: "v_true" },
		});
		expect(summary.attribution.after).toEqual({ fallthrough: 100 });
	});

	test("attributes matches to rule ids, off, and kill switch", () => {
		const rule = {
			id: "r_enterprise",
			clauses: [{ attribute: "plan", operator: "in", values: ["enterprise"] }],
			serve: { variationId: "v_true" },
		};
		const before = flag({ enabled: true, offVariationId: "v_false", rules: [], fallthrough: { variationId: "v_false" } });
		const after = flag({ enabled: true, offVariationId: "v_false", rules: [rule], fallthrough: { variationId: "v_false" } });
		const summary = summarizeImpact(
			audience,
			(context) => evaluate(before, "production", context),
			(context) => evaluate(after, "production", context),
		);
		expect(summary.flipped).toBe(25);
		expect(summary.attribution.after).toEqual({ r_enterprise: 25, fallthrough: 75 });
		expect(summary.flippedSample.every((entry) => entry.attributes.plan === "enterprise")).toBe(true);

		const killed = { ...after, killSwitch: { active: true } };
		const held = summarizeImpact(
			audience,
			(context) => evaluate(after, "production", context),
			(context) => evaluate(killed, "production", context),
		);
		expect(held.attribution.after).toEqual({ killSwitch: 100 });
		expect(held.flipped).toBe(25);
	});

	test("attributionKey maps every reason kind", () => {
		expect(attributionKey({ kind: REASONS.RULE_MATCH, ruleId: "r_1" })).toBe("r_1");
		expect(attributionKey({ kind: REASONS.RULE_MATCH, ruleIndex: 2 })).toBe("rule-2");
		expect(attributionKey({ kind: REASONS.OFF })).toBe("off");
		expect(attributionKey({ kind: REASONS.KILL_SWITCH })).toBe("killSwitch");
		expect(attributionKey({ kind: REASONS.FALLTHROUGH })).toBe("fallthrough");
		expect(attributionKey({ kind: REASONS.ERROR })).toBe("error");
	});

	test("an unchanged configuration flips nobody", () => {
		const config = flag({
			enabled: true,
			offVariationId: "v_false",
			rules: [],
			fallthrough: {
				rollout: {
					weights: [
						{ variationId: "v_true", weight: 25000 },
						{ variationId: "v_false", weight: 75000 },
					],
				},
			},
		});
		const summary = summarizeImpact(
			audience,
			(context) => evaluate(config, "production", context),
			(context) => evaluate(config, "production", context),
		);
		expect(summary.flipped).toBe(0);
		expect(summary.flippedSample).toEqual([]);
		expect(summary.before).toEqual(summary.after);
	});
});
