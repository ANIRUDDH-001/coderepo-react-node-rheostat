import { assertCan, can } from "../../shared/auth/permissions.js";
import { AppError } from "../../shared/errors/app-error.js";
import { auditService } from "../audit/audit.service.js";
import { diffEnvConfig, normalizeConfig } from "../flags/config-diff.js";
import { flagVersionRepository } from "../flags/flag-version.repository.js";
import { flagRepository } from "../flags/flag.repository.js";
import { flagService } from "../flags/flag.service.js";
import { environmentOf, projectService } from "../projects/project.service.js";
import { webhookEvents } from "../webhooks/events.js";
import {
	ACTIVE_STATUSES,
	buildSteps,
	compatibilityIssue,
	currentPercent,
	markRemainingSkipped,
	nextPendingStep,
	shiftForResume,
	validatePlan,
} from "./plan.js";
import { createReconciler } from "./reconcile.js";
import { rolloutPlanRepository } from "./rollout-plan.repository.js";

// Dependency direction (spec §5.13): rollouts → flags, projects. Never change-requests or governance.

const NOT_FOUND = () => new AppError(404, "ROLLOUT_NOT_FOUND", "The requested rollout does not exist.");
const INVALID_TRANSITION = (message) => new AppError(422, "INVALID_TRANSITION", message);

// Adapters over the real repositories for the reconciler. `audit.recordOnce` entries name the plan creator as actor.
const reconciler = createReconciler({
	plans: rolloutPlanRepository,
	flags: {
		findById: (id) => flagRepository.findById(id),
		mutateEnvironment: (flagId, environment, expectedVersion, fields, actorId, now) =>
			flagRepository.mutateEnvironment(flagId, environment, expectedVersion, fields, actorId, now),
		currentConfig: async (flagId, environment) => (await flagRepository.findById(flagId))?.environments[environment],
	},
	versions: flagVersionRepository,
	audit: {
		recordOnce: ({ actorId, ...entry }) => auditService.recordOnce({ ...entry, actor: { _id: actorId } }),
	},
	events: {
		emit: async ({ projectId, ...rest }) => webhookEvents.emit({ ...rest, project: await projectService.getById(projectId) }),
	},
});

// Read-model decoration shared by list, detail, and the flag page.
const summarize = (plan, flag = null) => ({
	...plan,
	currentPercent: currentPercent(plan),
	nextStep: nextPendingStep(plan),
	heldByKillSwitch: Boolean(flag?.killSwitch?.active) && ["scheduled", "running"].includes(plan.status),
});

async function audit(actor, action, plan, summary, metadata = {}) {
	await auditService.record({
		actor,
		action,
		entityType: "rollout",
		entityId: plan._id,
		entityLabel: plan.flagKey,
		projectId: plan.projectId,
		summary,
		metadata: { environment: plan.environment, flagKey: plan.flagKey, ...metadata },
	});
}

async function load(id) {
	const plan = await rolloutPlanRepository.findById(id);
	if (!plan) throw NOT_FOUND();
	const [project, flag] = await Promise.all([projectService.getById(plan.projectId), flagService.getById(plan.flagId)]);
	return { plan, project, flag, environment: environmentOf(project, plan.environment) };
}

const assertManage = (profile, environment) => assertCan(profile, "rollout:manage", { environment: { protected: environment.protected } });

export const rolloutService = {
	reconcileDue: (now = new Date()) => reconciler.reconcileDue(now),

	// Guard lookup used by governance and change requests (spec §5.12).
	async activeForFlag(flagId, environment) {
		const plan = await rolloutPlanRepository.findActiveForFlag(flagId, environment);
		return plan ? summarize(plan) : null;
	},

	// Per-environment map for the flag detail page.
	async activeByEnvironment(flag, environmentKeys) {
		const plans = await rolloutPlanRepository.findActive({ flagId: flag._id });
		return Object.fromEntries(
			environmentKeys.map((key) => {
				const plan = plans.find((candidate) => candidate.environment === key);
				return [key, plan ? summarize(plan, flag) : null];
			}),
		);
	},

	async list(project, { status, flagKey, page, pageSize }, profile) {
		assertCan(profile, "rollout:read");
		await this.reconcileDue();
		const filter = { projectId: project._id };
		if (status === "active") filter.status = { $in: ACTIVE_STATUSES };
		else if (status) filter.status = status;
		if (flagKey) filter.flagKey = flagKey;
		const [items, total, active] = await Promise.all([
			rolloutPlanRepository.findPage(filter, (page - 1) * pageSize, pageSize),
			rolloutPlanRepository.count(filter),
			rolloutPlanRepository.count({ projectId: project._id, status: { $in: ACTIVE_STATUSES } }),
		]);
		return { items: items.map((plan) => summarize(plan)), total, page, pageSize, counts: { active } };
	},

	async create(project, input, profile) {
		const environment = environmentOf(project, input.environment);
		assertManage(profile, environment);
		const flag = await flagService.getRawByKey(project, input.flagKey);
		if (flag.archived) throw INVALID_TRANSITION("Archived flags cannot be rolled out. Restore the flag first.");
		const config = flag.environments[environment.key];
		validatePlan(input, flag, config);
		if (await rolloutPlanRepository.findActiveForFlag(flag._id, environment.key)) {
			throw new AppError(409, "ROLLOUT_ALREADY_ACTIVE", `A rollout is already active for ${flag.key} in ${environment.name}.`);
		}
		let created;
		try {
			created = await rolloutPlanRepository.create({
				projectId: project._id,
				flagId: flag._id,
				flagKey: flag.key,
				environment: environment.key,
				targetVariationId: input.targetVariationId,
				baselineVariationId: input.baselineVariationId,
				bucketBy: input.bucketBy || "key",
				steps: buildSteps(input.steps),
				status: "scheduled",
				startedFromVersion: config.version,
				expectedVersion: config.version,
				createdBy: profile._id,
			});
		} catch (error) {
			if (error?.code === 11000)
				throw new AppError(409, "ROLLOUT_ALREADY_ACTIVE", `A rollout is already active for ${flag.key} in ${environment.name}.`);
			throw error;
		}
		const name = (id) => flag.variations.find((variation) => variation.id === id)?.name || id;
		await audit(
			profile,
			"rollout.created",
			created,
			`${profile.name} scheduled a ${created.steps.length}-step rollout of ${name(created.targetVariationId)} for ${flag.key} in ${environment.name}.`,
			{ steps: created.steps.map((step) => ({ percent: step.percent, startAt: step.startAt })), startedFromVersion: config.version },
		);
		// Steps due right now (a "start immediately" first step) apply before the response returns.
		await this.reconcileDue();
		return this.get(created._id, profile);
	},

	async get(id, profile) {
		assertCan(profile, "rollout:read");
		await this.reconcileDue();
		const { plan, project, flag, environment } = await load(id);
		const config = flag.environments[environment.key];
		const detail = {
			...summarize(plan, flag),
			flag: {
				_id: flag._id,
				key: flag.key,
				name: flag.name,
				variations: flag.variations,
				archived: flag.archived,
				killSwitch: flag.killSwitch,
			},
			environmentPolicy: environment,
			currentVersion: config.version,
			permissions: { canManage: can(profile.role, "rollout:manage", { environment: { protected: environment.protected } }) },
		};
		if (plan.status === "stalled") {
			const expected = await flagVersionRepository.findOne(flag._id, environment.key, plan.expectedVersion);
			detail.drift = {
				expectedVersion: plan.expectedVersion,
				currentVersion: config.version,
				diff: expected ? diffEnvConfig(expected.config, normalizeConfig(config)) : [],
				compatibility: compatibilityIssue({ ...plan, environmentName: environment.name }, config, flag),
			};
		}
		return detail;
	},

	async pause(id, profile) {
		const { plan, environment } = await load(id);
		assertManage(profile, environment);
		if (!["scheduled", "running"].includes(plan.status)) throw INVALID_TRANSITION(`A ${plan.status} rollout cannot be paused.`);
		const now = new Date();
		await rolloutPlanRepository.save(plan._id, { status: "paused", pausedAt: now });
		await audit(
			profile,
			"rollout.paused",
			plan,
			`${profile.name} paused the rollout of ${plan.flagKey} in ${environment.name} at ${currentPercent(plan)}%.`,
		);
		return this.get(id, profile);
	},

	// From paused: shift the schedule. From stalled: require pair compatibility, then adopt the current version.
	async resume(id, profile) {
		const { plan, flag, environment } = await load(id);
		assertManage(profile, environment);
		const now = new Date();
		const config = flag.environments[environment.key];
		if (plan.status === "paused") {
			const shifted = shiftForResume(plan, now);
			await rolloutPlanRepository.save(plan._id, {
				status: nextPendingStep(plan) ? "running" : "completed",
				pausedAt: null,
				steps: shifted.steps,
			});
			await audit(
				profile,
				"rollout.resumed",
				plan,
				`${profile.name} resumed the rollout of ${plan.flagKey} in ${environment.name}.`,
				{
					shiftedByMs: now.getTime() - new Date(plan.pausedAt).getTime(),
				},
			);
		} else if (plan.status === "stalled") {
			const issue = compatibilityIssue({ ...plan, environmentName: environment.name }, config, flag);
			if (issue)
				throw new AppError(422, "ROLLOUT_INCOMPATIBLE", issue, {
					expectedVersion: plan.expectedVersion,
					currentVersion: config.version,
				});
			await rolloutPlanRepository.save(plan._id, {
				status: nextPendingStep(plan) ? "running" : "completed",
				stallReason: null,
				pausedAt: null,
				expectedVersion: config.version,
			});
			await audit(
				profile,
				"rollout.resumed",
				plan,
				`${profile.name} resumed the stalled rollout of ${plan.flagKey} in ${environment.name}, adopting v${config.version}.`,
				{ adoptedVersion: config.version, previousExpectedVersion: plan.expectedVersion, stallReason: plan.stallReason },
			);
		} else throw INVALID_TRANSITION(`A ${plan.status} rollout cannot be resumed.`);
		await this.reconcileDue(now);
		return this.get(id, profile);
	},

	async abort(id, profile) {
		const { plan, project, flag, environment } = await load(id);
		assertManage(profile, environment);
		if (!ACTIVE_STATUSES.includes(plan.status)) throw INVALID_TRANSITION(`A ${plan.status} rollout cannot be aborted.`);
		const now = new Date();
		const skipped = markRemainingSkipped(plan);
		await rolloutPlanRepository.save(plan._id, { status: "aborted", steps: skipped.steps, resolvedAt: now, pausedAt: null });
		await audit(
			profile,
			"rollout.aborted",
			plan,
			`${profile.name} aborted the rollout of ${plan.flagKey} in ${environment.name} at ${currentPercent(plan)}%.`,
			{
				startedFromVersion: plan.startedFromVersion,
			},
		);
		await webhookEvents.emit({
			event: "rollout.aborted",
			eventId: `rollout:${plan._id}:aborted`,
			project,
			environment: plan.environment,
			flag,
			data: {
				planId: String(plan._id),
				environment: plan.environment,
				currentPercent: currentPercent(plan),
				actorId: String(profile._id),
			},
		});
		return this.get(id, profile);
	},
};
