import { describe, expect, test } from "bun:test";
import {
	BASELINE_MESSAGE,
	compatibilityIssue,
	currentPercent,
	dueSteps,
	isComplete,
	markRemainingSkipped,
	shiftForResume,
	validatePlan,
	weightsForPercent,
} from "./plan.js";

const flag = {
	variations: [
		{ id: "v_off", name: "Legacy" },
		{ id: "v_on", name: "New checkout" },
		{ id: "v_alt", name: "Alternate" },
	],
};
const fixed = (variationId, enabled = true) => ({ enabled, fallthrough: { variationId } });
const rollout = (weights, enabled = true) => ({ enabled, fallthrough: { rollout: { bucketBy: "key", weights } } });
const plan = (overrides = {}) => ({ targetVariationId: "v_on", baselineVariationId: "v_off", bucketBy: "key", steps: [], ...overrides });
const input = (overrides = {}) => ({
	targetVariationId: "v_on",
	baselineVariationId: "v_off",
	steps: [
		{ percent: 10, startAt: "2026-09-20T10:00:00Z" },
		{ percent: 50, startAt: "2026-09-21T10:00:00Z" },
	],
	...overrides,
});
const issuesOf = (fn) => {
	try {
		fn();
	} catch (error) {
		return error.details.issues;
	}
	return [];
};

describe("validatePlan", () => {
	test("accepts a fixed fallthrough equal to the baseline", () => {
		expect(() => validatePlan(input(), flag, fixed("v_off"))).not.toThrow();
	});
	test("baseline must be the served variation when the fallthrough is fixed", () => {
		const issues = issuesOf(() => validatePlan(input(), flag, fixed("v_alt")));
		expect(issues[0]).toContain(BASELINE_MESSAGE);
		expect(issues[0]).toContain("Alternate");
	});
	test("an existing rollout must share the target/baseline pair", () => {
		const shared = rollout([
			{ variationId: "v_off", weight: 75000 },
			{ variationId: "v_on", weight: 25000 },
			{ variationId: "v_alt", weight: 0 },
		]);
		expect(() => validatePlan(input(), flag, shared)).not.toThrow();
		const other = rollout([
			{ variationId: "v_off", weight: 50000 },
			{ variationId: "v_alt", weight: 50000 },
		]);
		expect(issuesOf(() => validatePlan(input(), flag, other))[0]).toContain(BASELINE_MESSAGE);
	});
	test("target must differ from baseline and both must exist", () => {
		expect(issuesOf(() => validatePlan(input({ targetVariationId: "v_off" }), flag, fixed("v_off")))).toContain(
			"Target and baseline must be different variations.",
		);
		expect(issuesOf(() => validatePlan(input({ targetVariationId: "nope" }), flag, fixed("v_off")))).toContain(
			"Target variation does not belong to this flag.",
		);
	});
	test("percents and start times must strictly increase; steps required", () => {
		const bad = input({
			steps: [
				{ percent: 50, startAt: "2026-09-21T10:00:00Z" },
				{ percent: 50, startAt: "2026-09-21T10:00:00Z" },
			],
		});
		const issues = issuesOf(() => validatePlan(bad, flag, fixed("v_off")));
		expect(issues).toContain("Step 2: percents must increase from step to step.");
		expect(issues).toContain("Step 2: start times must increase from step to step.");
		expect(issuesOf(() => validatePlan(input({ steps: [] }), flag, fixed("v_off")))).toContain("Add at least one step.");
		expect(issuesOf(() => validatePlan(input({ steps: [{ percent: 101, startAt: "x" }] }), flag, fixed("v_off")))).toEqual([
			"Step 1: percent must be a whole number between 1 and 100.",
			"Step 1: start time is not a valid date.",
		]);
	});
	test("targeting must be enabled", () => {
		expect(issuesOf(() => validatePlan(input(), flag, fixed("v_off", false)))).toContain(
			"Targeting must be on in this environment before a rollout can start.",
		);
	});
});

describe("weightsForPercent", () => {
	test("covers every variation with zeros and sums to 100000", () => {
		const weights = weightsForPercent(plan(), flag, 25);
		expect(weights).toEqual([
			{ variationId: "v_off", weight: 75000 },
			{ variationId: "v_on", weight: 25000 },
			{ variationId: "v_alt", weight: 0 },
		]);
		expect(weights.reduce((sum, entry) => sum + entry.weight, 0)).toBe(100000);
		expect(weightsForPercent(plan(), flag, 100).find((entry) => entry.variationId === "v_off").weight).toBe(0);
	});
});

describe("scheduling helpers", () => {
	const steps = [
		{ id: "s1", percent: 5, startAt: new Date("2026-09-18T10:00:00Z"), status: "applied" },
		{ id: "s2", percent: 25, startAt: new Date("2026-09-19T10:00:00Z"), status: "pending" },
		{ id: "s3", percent: 50, startAt: new Date("2026-09-20T10:00:00Z"), status: "pending" },
	];
	test("dueSteps returns pending steps whose start has passed, in order", () => {
		expect(dueSteps(plan({ steps }), new Date("2026-09-19T12:00:00Z")).map((step) => step.id)).toEqual(["s2"]);
		expect(dueSteps(plan({ steps }), new Date("2026-09-21T00:00:00Z")).map((step) => step.id)).toEqual(["s2", "s3"]);
		expect(dueSteps(plan({ steps }), new Date("2026-09-19T09:00:00Z"))).toEqual([]);
	});
	test("shiftForResume preserves the gaps between pending steps", () => {
		const paused = plan({ steps, pausedAt: new Date("2026-09-19T09:00:00Z") });
		const shifted = shiftForResume(paused, new Date("2026-09-19T11:00:00Z"));
		expect(shifted.steps[0].startAt).toEqual(steps[0].startAt);
		expect(shifted.steps[1].startAt).toEqual(new Date("2026-09-19T12:00:00Z"));
		expect(shifted.steps[2].startAt).toEqual(new Date("2026-09-20T12:00:00Z"));
	});
	test("markRemainingSkipped, isComplete and currentPercent", () => {
		const aborted = markRemainingSkipped(plan({ steps }));
		expect(aborted.steps.map((step) => step.status)).toEqual(["applied", "skipped", "skipped"]);
		expect(isComplete(aborted)).toBe(true);
		expect(isComplete(plan({ steps }))).toBe(false);
		expect(currentPercent(plan({ steps }))).toBe(5);
		expect(currentPercent(plan({ steps: [{ ...steps[1], status: "pending" }] }))).toBe(0);
		expect(isComplete(plan({ steps: [steps[0], { ...steps[1], status: "applied" }] }))).toBe(true);
	});
});

describe("compatibilityIssue", () => {
	const flagPlan = plan({ environment: "production", environmentName: "Production" });
	test("compatible: fixed baseline, fixed target, rollout over the pair at any split", () => {
		expect(compatibilityIssue(flagPlan, fixed("v_off"), flag)).toBeNull();
		expect(compatibilityIssue(flagPlan, fixed("v_on"), flag)).toBeNull();
		const split = rollout([
			{ variationId: "v_off", weight: 40000 },
			{ variationId: "v_on", weight: 60000 },
			{ variationId: "v_alt", weight: 0 },
		]);
		expect(compatibilityIssue(flagPlan, split, flag)).toBeNull();
	});
	test("incompatible: disabled, fixed third variation, rollout including a third variation", () => {
		expect(compatibilityIssue(flagPlan, fixed("v_off", false), flag)).toContain("turned off");
		expect(compatibilityIssue(flagPlan, fixed("v_alt"), flag)).toBe("Production now serves Alternate, which is not part of this rollout.");
		const third = rollout([
			{ variationId: "v_off", weight: 50000 },
			{ variationId: "v_on", weight: 40000 },
			{ variationId: "v_alt", weight: 10000 },
		]);
		expect(compatibilityIssue(flagPlan, third, flag)).toContain("Alternate");
	});
});
