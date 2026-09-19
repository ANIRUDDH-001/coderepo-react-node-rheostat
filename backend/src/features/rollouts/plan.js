import { AppError } from "../../shared/errors/app-error.js";
import { shortId } from "../../shared/utils/keys.js";

// Pure rollout-plan logic (spec §5.4): validation, weight derivation, scheduling helpers, and the
// pair-compatibility check used when resuming a stalled plan. No persistence here.

export const BUCKET_SPACE = 100000;
export const ACTIVE_STATUSES = ["scheduled", "running", "paused", "stalled"];
export const PLAN_STATUSES = [...ACTIVE_STATUSES, "completed", "aborted"];
export const STEP_STATUSES = ["pending", "applying", "applied", "skipped"];
export const STALL_REASONS = ["CONFIG_CHANGED_OUTSIDE_ROLLOUT", "RECOVERY_AMBIGUOUS"];
export const BASELINE_MESSAGE = "Baseline must be the variation currently served";

const INVALID = (issues) =>
	new AppError(422, "INVALID_CONFIG", issues[0] || "The rollout plan is invalid.", { issues });

const variationName = (flag, id) => flag.variations.find((variation) => variation.id === id)?.name || id;

// Which variations the fallthrough currently serves: a fixed id, or the set with non-zero weights.
export const servedVariations = (config) => {
	const serve = config?.fallthrough;
	if (!serve) return [];
	if (serve.rollout) return serve.rollout.weights.filter((entry) => entry.weight > 0).map((entry) => entry.variationId);
	return serve.variationId ? [serve.variationId] : [];
};

const validDate = (value) => {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
};

// Throws 422 INVALID_CONFIG with every issue found. `config` is the live environment config at creation time.
export function validatePlan(input, flag, config) {
	const issues = [];
	const ids = new Set(flag.variations.map((variation) => variation.id));
	if (!ids.has(input.targetVariationId)) issues.push("Target variation does not belong to this flag.");
	if (!ids.has(input.baselineVariationId)) issues.push("Baseline variation does not belong to this flag.");
	if (input.targetVariationId === input.baselineVariationId) issues.push("Target and baseline must be different variations.");
	if (!Array.isArray(input.steps) || input.steps.length === 0) issues.push("Add at least one step.");
	else {
		let lastPercent = 0;
		let lastStart = null;
		input.steps.forEach((step, index) => {
			const label = `Step ${index + 1}`;
			const percent = Number(step.percent);
			if (!Number.isFinite(percent) || percent <= 0 || percent > 100 || !Number.isInteger(percent)) {
				issues.push(`${label}: percent must be a whole number between 1 and 100.`);
			} else if (percent <= lastPercent) issues.push(`${label}: percents must increase from step to step.`);
			lastPercent = Number.isFinite(percent) ? Math.max(lastPercent, percent) : lastPercent;
			const start = validDate(step.startAt);
			if (!start) issues.push(`${label}: start time is not a valid date.`);
			else if (lastStart && start <= lastStart) issues.push(`${label}: start times must increase from step to step.`);
			if (start) lastStart = start;
		});
	}
	if (!config?.enabled) issues.push("Targeting must be on in this environment before a rollout can start.");
	if (ids.has(input.baselineVariationId) && ids.has(input.targetVariationId) && config) {
		const served = servedVariations(config);
		const pair = new Set([input.baselineVariationId, input.targetVariationId]);
		const fixed = !config.fallthrough?.rollout;
		const compatible = fixed
			? served[0] === input.baselineVariationId
			: served.length > 0 && served.every((id) => pair.has(id));
		if (!compatible) {
			const currently = served.length ? served.map((id) => variationName(flag, id)).join(" and ") : "nothing";
			issues.push(`${BASELINE_MESSAGE} (the fallthrough currently serves ${currently}).`);
		}
	}
	if (issues.length) throw INVALID(issues);
}

// Materialises the stored plan from validated input: step ids, pending status, dates.
export const buildSteps = (steps) =>
	steps.map((step) => ({ id: shortId("s"), percent: Number(step.percent), startAt: new Date(step.startAt), status: "pending" }));

// Target gets p%, baseline the rest, every other variation an explicit zero (spec §5.4).
export function weightsForPercent(plan, flag, percent) {
	const target = Math.round(percent * 1000);
	return flag.variations.map((variation) => ({
		variationId: variation.id,
		weight: variation.id === plan.targetVariationId ? target : variation.id === plan.baselineVariationId ? BUCKET_SPACE - target : 0,
	}));
}

export const fallthroughForStep = (plan, flag, step) => ({
	rollout: { bucketBy: plan.bucketBy || "key", weights: weightsForPercent(plan, flag, step.percent) },
});

export const dueSteps = (plan, now) =>
	plan.steps.filter((step) => step.status === "pending" && new Date(step.startAt) <= now).sort((a, b) => new Date(a.startAt) - new Date(b.startAt));

export const nextPendingStep = (plan) => plan.steps.find((step) => step.status === "pending") || null;

// Pending steps move forward by the time spent paused, so the gaps between them are preserved.
export function shiftForResume(plan, now) {
	if (!plan.pausedAt) return plan;
	const delta = now.getTime() - new Date(plan.pausedAt).getTime();
	if (delta <= 0) return plan;
	return {
		...plan,
		steps: plan.steps.map((step) =>
			step.status === "pending" ? { ...step, startAt: new Date(new Date(step.startAt).getTime() + delta) } : step,
		),
	};
}

export const markRemainingSkipped = (plan) => ({
	...plan,
	steps: plan.steps.map((step) => (step.status === "pending" || step.status === "applying" ? { ...step, status: "skipped" } : step)),
});

export const isComplete = (plan) => !plan.steps.some((step) => step.status === "pending" || step.status === "applying");

export const currentPercent = (plan) => {
	const applied = plan.steps.filter((step) => step.status === "applied");
	return applied.length ? applied[applied.length - 1].percent : 0;
};

// Null when the live config can still be driven by this plan; otherwise a sentence for the operator.
export function compatibilityIssue(plan, config, flag) {
	const name = (id) => variationName(flag, id);
	const environment = plan.environmentName || plan.environment;
	if (!config?.enabled) return `${environment} has targeting turned off, so the rollout has nothing to redistribute.`;
	const pair = new Set([plan.baselineVariationId, plan.targetVariationId]);
	const served = servedVariations(config);
	if (!served.length) return `${environment} does not serve any variation from its fallthrough.`;
	const outsider = served.find((id) => !pair.has(id));
	if (outsider) return `${environment} now serves ${name(outsider)}, which is not part of this rollout.`;
	return null;
}
