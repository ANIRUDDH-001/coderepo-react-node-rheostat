import { FlagVersion } from "../../features/flags/flag-version.model.js";
import { RolloutPlan } from "../../features/rollouts/rollout-plan.model.js";
import { daysAgo, daysFromNow } from "./clock.js";

// Three plans covering the states the UI shows: running (next step tomorrow), paused, and completed.
// Applied steps point at the rollout-sourced FlagVersions the flag seeder wrote (reason "Rollout step N%").
const rolloutCatalog = [
	{
		project: "storefront",
		flagKey: "new-checkout",
		environment: "production",
		environmentName: "Production",
		createdBy: "marcus.chen@rheostat.team",
		createdAt: daysAgo(4, 11, 30),
		status: "running",
		steps: [
			{ percent: 5, startAt: daysAgo(3, 11), applied: true },
			{ percent: 25, startAt: daysAgo(1, 11), applied: true },
			{ percent: 50, startAt: daysFromNow(1, 10) },
			{ percent: 100, startAt: daysFromNow(3, 10) },
		],
	},
	{
		project: "mobile",
		flagKey: "onboarding-v3",
		environment: "staging",
		environmentName: "Staging",
		createdBy: "marcus.chen@rheostat.team",
		createdAt: daysAgo(7, 11, 30),
		status: "paused",
		pausedAt: daysAgo(5, 14),
		pauseReason: "Holding at 10% until the recommendations service ships its latency fix.",
		steps: [
			{ percent: 10, startAt: daysAgo(6, 11), applied: true },
			{ percent: 50, startAt: daysAgo(4, 11) },
			{ percent: 100, startAt: daysAgo(2, 11) },
		],
	},
	{
		project: "mobile",
		flagKey: "dark-mode-default",
		environment: "production",
		environmentName: "Production",
		createdBy: "marcus.chen@rheostat.team",
		createdAt: daysAgo(16, 11, 30),
		status: "completed",
		steps: [
			{ percent: 5, startAt: daysAgo(14, 11), applied: true },
			{ percent: 50, startAt: daysAgo(9, 11), applied: true },
			{ percent: 100, startAt: daysAgo(4, 11), applied: true },
		],
	},
];

export async function seedRollouts(projects, flags, people) {
	console.log("\nSeeding rollout plans...");
	const plans = [];
	const versionUpdates = [];
	const audit = [];
	for (const definition of rolloutCatalog) {
		const project = projects.byKey.get(definition.project);
		const flag = flags.byKey.get(definition.flagKey);
		const actor = people.byEmail.get(definition.createdBy);
		const planId = new RolloutPlan()._id;
		const target = flag.variations.find((variation) => variation.id === "v_true");
		let startedFromVersion = null;
		let expectedVersion = null;
		let lastAppliedStepId = null;
		const steps = definition.steps.map((step, index) => {
			const id = `s_seed${index + 1}`;
			if (!step.applied) return { id, percent: step.percent, startAt: step.startAt, status: "pending" };
			const version = flags.versions.find(
				(candidate) =>
					candidate.flagId.equals(flag._id) &&
					candidate.environment === definition.environment &&
					candidate.source === "rollout" &&
					candidate.reason === `Rollout step ${step.percent}%`,
			);
			if (!version)
				throw new Error(`Seed mismatch: no rollout version for ${definition.flagKey} ${definition.environment} ${step.percent}%`);
			if (startedFromVersion === null) startedFromVersion = version.version - 1;
			expectedVersion = version.version;
			lastAppliedStepId = id;
			versionUpdates.push({ _id: version._id, rolloutPlanId: planId, stepId: id });
			audit.push({
				projectId: project._id,
				actorId: actor._id,
				action: "rollout.stepApplied",
				entityType: "rollout",
				entityId: String(planId),
				entityLabel: flag.key,
				summary: `Rollout step ${step.percent}% applied to ${flag.key} in ${definition.environment} (v${version.version}).`,
				metadata: {
					environment: definition.environment,
					flagKey: flag.key,
					percent: step.percent,
					version: version.version,
					stepId: id,
				},
				idempotencyKey: `rollout:${planId}:${id}:applied`,
				at: version.createdAt,
			});
			return {
				id,
				percent: step.percent,
				startAt: step.startAt,
				status: "applied",
				appliedAt: version.createdAt,
				appliedVersion: version.version,
			};
		});
		const lastApplied = definition.steps.filter((step) => step.applied).at(-1);
		plans.push({
			_id: planId,
			projectId: project._id,
			flagId: flag._id,
			flagKey: flag.key,
			environment: definition.environment,
			targetVariationId: "v_true",
			baselineVariationId: "v_false",
			bucketBy: "key",
			steps,
			status: definition.status,
			startedFromVersion,
			expectedVersion,
			lastAppliedStepId,
			pausedAt: definition.pausedAt || null,
			resolvedAt: definition.status === "completed" ? steps.at(-1).appliedAt : null,
			createdBy: actor._id,
			createdAt: definition.createdAt,
			updatedAt: definition.pausedAt || steps.at(-1).appliedAt || definition.createdAt,
		});
		audit.push({
			projectId: project._id,
			actorId: actor._id,
			action: "rollout.created",
			entityType: "rollout",
			entityId: String(planId),
			entityLabel: flag.key,
			summary: `${actor.name} scheduled a ${steps.length}-step rollout of ${target.name} for ${flag.key} in ${definition.environmentName}.`,
			metadata: {
				environment: definition.environment,
				flagKey: flag.key,
				steps: definition.steps.map((step) => ({ percent: step.percent, startAt: step.startAt })),
				startedFromVersion,
			},
			at: definition.createdAt,
		});
		if (definition.status === "paused") {
			audit.push({
				projectId: project._id,
				actorId: actor._id,
				action: "rollout.paused",
				entityType: "rollout",
				entityId: String(planId),
				entityLabel: flag.key,
				summary: `${actor.name} paused the rollout of ${flag.key} in ${definition.environmentName} at ${lastApplied.percent}%. ${definition.pauseReason}`,
				metadata: { environment: definition.environment, flagKey: flag.key },
				at: definition.pausedAt,
			});
		}
		if (definition.status === "completed") {
			audit.push({
				projectId: project._id,
				actorId: actor._id,
				action: "rollout.completed",
				entityType: "rollout",
				entityId: String(planId),
				entityLabel: flag.key,
				summary: `Rollout of ${flag.key} in ${definition.environment} completed at ${lastApplied.percent}%.`,
				metadata: { environment: definition.environment, flagKey: flag.key, percent: lastApplied.percent },
				idempotencyKey: `rollout:${planId}:completed`,
				at: steps.at(-1).appliedAt,
			});
		}
	}
	const created = await RolloutPlan.insertMany(plans);
	await Promise.all(versionUpdates.map(({ _id, ...fields }) => FlagVersion.updateOne({ _id }, { $set: fields })));
	console.log(`  Created ${created.length} rollout plans`);
	return { plans: created, audit };
}
