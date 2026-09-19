import { normalizeConfig, normalizeServe } from "../flags/config-diff.js";
import { dueSteps, fallthroughForStep, isComplete } from "./plan.js";

// Reconciler (spec §5.5): applies due steps with a claim + guarded write, and resolves stale claims
// deterministically. Every collaborator is injected so the branches are unit-testable with fakes:
//   plans    = { findDue(now), findStaleClaims(before), claimStep(planId, stepId, at), releaseStep(planId, stepId),
//                markApplied(planId, stepId, version, at) → plan, stall(planId, reason, at), complete(planId, at) }
//   flags    = { findById(id), mutateEnvironment(flagId, env, expectedVersion, fields, actorId, now) → flag | null,
//                currentConfig(flagId, env) → { version, enabled, fallthrough } }
//   versions = { insert(doc) → doc (duplicate key throws { code: 11000 }), findByStep(planId, stepId) }
//   audit    = { recordOnce(entry) } — the entry carries `actorId`; the adapter resolves the person.

export const STALE_CLAIM_MS = 120000;
export const appliedKey = (planId, stepId) => `rollout:${planId}:${stepId}:applied`;

const sortedWeights = (serve) => [...(serve.rollout?.weights || [])].sort((a, b) => (a.variationId < b.variationId ? -1 : 1));
const sameServe = (left, right) => {
	const a = normalizeServe(left);
	const b = normalizeServe(right);
	if (Boolean(a.rollout) !== Boolean(b.rollout)) return false;
	if (!a.rollout) return a.variationId === b.variationId;
	return (
		a.rollout.bucketBy === b.rollout.bucketBy &&
		JSON.stringify(sortedWeights(a).filter((w) => w.weight > 0)) === JSON.stringify(sortedWeights(b).filter((w) => w.weight > 0))
	);
};

export function createReconciler({ plans, flags, versions, audit, staleClaimMs = STALE_CLAIM_MS }) {
	const snapshotOf = (plan, flag, step, config, version) => ({
		flagId: flag._id,
		projectId: flag.projectId,
		environment: plan.environment,
		version,
		config: normalizeConfig(config),
		actorId: plan.createdBy,
		reason: `Rollout step ${step.percent}%`,
		source: "rollout",
		rolloutPlanId: plan._id,
		stepId: step.id,
	});

	// Audit (idempotent) → mark applied → complete when nothing is left. Safe to repeat.
	async function finalize(plan, flag, step, version, now) {
		await audit.recordOnce({
			idempotencyKey: appliedKey(plan._id, step.id),
			actorId: plan.createdBy,
			action: "rollout.stepApplied",
			entityType: "rollout",
			entityId: plan._id,
			entityLabel: flag.key,
			projectId: flag.projectId,
			summary: `Rollout step ${step.percent}% applied to ${flag.key} in ${plan.environment} (v${version}).`,
			metadata: { environment: plan.environment, flagKey: flag.key, percent: step.percent, version, stepId: step.id },
			at: now,
		});
		const updated = await plans.markApplied(plan._id, step.id, version, now);
		if (updated && isComplete(updated)) {
			await plans.complete(plan._id, now);
			await audit.recordOnce({
				idempotencyKey: `rollout:${plan._id}:completed`,
				actorId: plan.createdBy,
				action: "rollout.completed",
				entityType: "rollout",
				entityId: plan._id,
				entityLabel: flag.key,
				projectId: flag.projectId,
				summary: `Rollout of ${flag.key} in ${plan.environment} completed at ${step.percent}%.`,
				metadata: { environment: plan.environment, flagKey: flag.key, percent: step.percent },
				at: now,
			});
			return { ...updated, status: "completed" };
		}
		return updated;
	}

	async function stall(plan, flag, reason, now, extra = {}) {
		await plans.stall(plan._id, reason, now);
		await audit.recordOnce({
			idempotencyKey: `rollout:${plan._id}:stalled:${extra.version ?? "?"}:${reason}`,
			actorId: plan.createdBy,
			action: "rollout.stalled",
			entityType: "rollout",
			entityId: plan._id,
			entityLabel: flag.key,
			projectId: flag.projectId,
			summary:
				reason === "CONFIG_CHANGED_OUTSIDE_ROLLOUT"
					? `Rollout of ${flag.key} in ${plan.environment} stalled: the configuration changed outside the rollout (expected v${plan.expectedVersion}, found v${extra.version}).`
					: `Rollout of ${flag.key} in ${plan.environment} stalled: a step could not be recovered unambiguously.`,
			metadata: { environment: plan.environment, flagKey: flag.key, reason, expectedVersion: plan.expectedVersion, ...extra },
			at: now,
		});
	}

	// The claimed step is written with the version guard; the outcome decides between applied, raced, and stalled.
	async function applyClaimed(plan, flag, step, now) {
		const fallthrough = fallthroughForStep(plan, flag, step);
		const updated = await flags.mutateEnvironment(flag._id, plan.environment, plan.expectedVersion, { fallthrough }, plan.createdBy, now);
		if (!updated) {
			const current = await flags.currentConfig(flag._id, plan.environment);
			await plans.releaseStep(plan._id, step.id);
			if (current.version !== plan.expectedVersion) {
				await stall(plan, flag, "CONFIG_CHANGED_OUTSIDE_ROLLOUT", now, { version: current.version });
				return { outcome: "stalled" };
			}
			return { outcome: "raced" };
		}
		const written = updated.environments[plan.environment];
		let snapshot;
		try {
			snapshot = await versions.insert(snapshotOf(plan, flag, step, written, written.version));
		} catch (error) {
			if (error?.code !== 11000) throw error;
			snapshot = await versions.findByStep(plan._id, step.id);
		}
		return { outcome: "applied", plan: await finalize(plan, flag, step, snapshot.version, now) };
	}

	async function recover(plan, step, now) {
		const flag = await flags.findById(plan.flagId);
		if (!flag) return;
		const existing = await versions.findByStep(plan._id, step.id);
		if (existing) {
			await finalize(plan, flag, step, existing.version, now);
			return;
		}
		const current = await flags.currentConfig(flag._id, plan.environment);
		if (current.version === plan.expectedVersion) {
			await plans.releaseStep(plan._id, step.id);
			return;
		}
		const expected = fallthroughForStep(plan, flag, step);
		if (current.version === plan.expectedVersion + 1 && current.enabled && sameServe(current.fallthrough, expected)) {
			let snapshot;
			try {
				snapshot = await versions.insert(snapshotOf(plan, flag, step, current, current.version));
			} catch (error) {
				if (error?.code !== 11000) throw error;
				snapshot = await versions.findByStep(plan._id, step.id);
			}
			await finalize(plan, flag, step, snapshot.version, now);
			return;
		}
		await plans.releaseStep(plan._id, step.id);
		await stall(plan, flag, "RECOVERY_AMBIGUOUS", now, { version: current.version });
	}

	return {
		async reconcileDue(now = new Date()) {
			const before = new Date(now.getTime() - staleClaimMs);
			for (const plan of await plans.findStaleClaims(before)) {
				for (const step of plan.steps.filter((entry) => entry.status === "applying" && entry.claimedAt && new Date(entry.claimedAt) < before)) {
					await recover(plan, step, now);
				}
			}
			for (let plan of await plans.findDue(now)) {
				const flag = await flags.findById(plan.flagId);
				if (!flag || flag.killSwitch?.active) continue;
				for (const step of dueSteps(plan, now)) {
					if (!(await plans.claimStep(plan._id, step.id, now))) break;
					const result = await applyClaimed(plan, flag, step, now);
					if (result.outcome !== "applied") break;
					plan = result.plan;
					if (!plan || plan.status !== "running") break;
				}
			}
		},
	};
}
