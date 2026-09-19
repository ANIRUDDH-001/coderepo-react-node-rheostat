import { AppError } from "../../shared/errors/app-error.js";
import { assertCan, can } from "../../shared/auth/permissions.js";
import { shortId } from "../../shared/utils/keys.js";
import { pageResult } from "../../shared/utils/pagination.js";
import { assertNoActiveRollout } from "../../shared/utils/rollout-guard.js";
import { auditService } from "../audit/audit.service.js";
import { evaluationService } from "../evaluation/evaluation.service.js";
import { diffEnvConfig, isEquivalent, normalizeConfig } from "../flags/config-diff.js";
import { validateEnvConfig } from "../flags/config-validation.js";
import { flagService } from "../flags/flag.service.js";
import { environmentOf, projectService } from "../projects/project.service.js";
import { segmentService } from "../segments/segment.service.js";
import { changeRequestDeps } from "./change-request.deps.js";
import { changeRequestRepository } from "./change-request.repository.js";
import { canComment, detectStale, transition } from "./transitions.js";

export const CHANGE_REQUEST_NOT_FOUND = () => new AppError(404, "CHANGE_REQUEST_NOT_FOUND", "The requested change request does not exist.");

const withRuleIds = (config) => ({ ...config, rules: (config.rules || []).map((rule) => ({ ...rule, id: rule.id || shortId("r") })) });

const audit = (actor, action, changeRequest, summary, metadata = {}) =>
	auditService.record({
		actor,
		action,
		entityType: "changeRequest",
		entityId: changeRequest._id,
		entityLabel: changeRequest.title,
		projectId: changeRequest.projectId,
		summary,
		metadata: { flagKey: changeRequest.flagKey, environment: changeRequest.environment, kind: changeRequest.kind, ...metadata },
	});

async function validated(project, flag, config) {
	const segments = await segmentService.mapByKey(project._id);
	const proposed = withRuleIds(normalizeConfig(config));
	validateEnvConfig(proposed, flag, new Set(Object.keys(segments)));
	return proposed;
}

const conflictError = (changeRequest) =>
	new AppError(
		409,
		"VERSION_CONFLICT",
		"The target environment changed since this request was made. Rebase it and request a fresh review.",
		{
			changeRequestId: String(changeRequest._id),
			status: changeRequest.status,
		},
	);

// Loads the request with its project and flag; stale detection runs here so every reader sees the same status,
// and the transition is written back with one audit entry naming who observed it.
async function load(id, actor) {
	const stored = await changeRequestRepository.findById(id);
	if (!stored) throw CHANGE_REQUEST_NOT_FOUND();
	const [project, flag] = await Promise.all([projectService.getById(stored.projectId), flagService.getById(stored.flagId)]);
	const currentVersion = flag.environments[stored.environment].version;
	let changeRequest = stored;
	let becameConflicted = false;
	const detected = detectStale(stored, currentVersion);
	if (detected.status !== stored.status) {
		changeRequest = await changeRequestRepository.save(stored._id, detected);
		becameConflicted = true;
		await audit(
			actor,
			"changeRequest.conflicted",
			changeRequest,
			`"${changeRequest.title}" conflicts with v${currentVersion} of ${changeRequest.flagKey} in ${changeRequest.environment}.`,
			{
				baseVersion: changeRequest.baseVersion,
				currentVersion,
			},
		);
	}
	return { changeRequest, project, flag, currentVersion, becameConflicted };
}

const activeRolloutFor = (flag, environment) =>
	changeRequestDeps.rollouts ? changeRequestDeps.rollouts.activeForFlag(flag._id, environment) : Promise.resolve(null);

async function open(project, flag, environmentKey, profile, fields) {
	assertCan(profile, "changeRequest:create");
	if (flag.archived) throw new AppError(422, "INVALID_TRANSITION", "Archived flags cannot be changed. Restore the flag first.");
	const environment = environmentOf(project, environmentKey);
	const current = flag.environments[environment.key];
	if (isEquivalent(current, fields.proposedConfig)) {
		throw new AppError(422, "INVALID_TRANSITION", `The proposal is identical to the current ${environment.name} configuration.`);
	}
	const draft = transition(
		{
			projectId: project._id,
			flagId: flag._id,
			flagKey: flag.key,
			environment: environment.key,
			policy: { requiredApprovals: environment.requiredApprovals },
			comments: [],
			...fields,
		},
		"create",
		profile,
		new Date(),
		{ currentVersion: current.version },
	);
	const created = await changeRequestRepository.create(draft);
	await audit(
		profile,
		"changeRequest.created",
		created,
		`${profile.name} proposed "${created.title}" for ${flag.key} in ${environment.name}.`,
		{
			baseVersion: created.baseVersion,
		},
	);
	return created;
}

export const changeRequestService = {
	async list(project, { status, flagKey, mine, needsMyReview, page, pageSize }, profile) {
		assertCan(profile, "changeRequest:read");
		const filter = { projectId: project._id };
		if (status) filter.status = status;
		if (flagKey) filter.flagKey = flagKey;
		if (mine) filter.authorId = profile._id;
		const reviewFilter = {
			projectId: project._id,
			status: "pending",
			authorId: { $ne: profile._id },
			"reviews.reviewerId": { $ne: profile._id },
		};
		if (needsMyReview) Object.assign(filter, reviewFilter);
		const [items, total, mineCount, reviewCount] = await Promise.all([
			changeRequestRepository.findPage(filter, (page - 1) * pageSize, pageSize),
			changeRequestRepository.count(filter),
			changeRequestRepository.count({
				projectId: project._id,
				authorId: profile._id,
				status: { $in: ["pending", "approved", "conflicted"] },
			}),
			can(profile.role, "changeRequest:review") ? changeRequestRepository.count(reviewFilter) : Promise.resolve(0),
		]);
		return { ...pageResult(items, total, page, pageSize), counts: { mine: mineCount, needsMyReview: reviewCount } };
	},

	async create(project, { flagKey, environment, title, description, proposedConfig }, profile) {
		const flag = await flagService.getRawByKey(project, flagKey);
		const proposed = await validated(project, flag, proposedConfig);
		return open(project, flag, environment, profile, { kind: "manual", title, description, proposedConfig: proposed });
	},

	async createFromPromotion(project, flag, environmentKey, sourceKey, profile) {
		const source = environmentOf(project, sourceKey);
		const target = environmentOf(project, environmentKey);
		const sourceConfig = flag.environments[source.key];
		const proposed = await validated(project, flag, sourceConfig);
		return open(project, flag, target.key, profile, {
			kind: "promotion",
			title: `Promote ${flag.key} from ${source.name} (v${sourceConfig.version}) to ${target.name}`,
			description: "",
			proposedConfig: proposed,
			sourceEnvironment: source.key,
			sourceVersion: sourceConfig.version,
		});
	},

	async createFromRollback(project, flag, environmentKey, version, profile) {
		const target = environmentOf(project, environmentKey);
		const snapshot = await flagService.getVersion(flag, target.key, version);
		const proposed = await validated(project, flag, snapshot.config);
		return open(project, flag, target.key, profile, {
			kind: "rollback",
			title: `Roll back ${flag.key} in ${target.name} to v${version}`,
			description: snapshot.reason ? `Restores v${version}: ${snapshot.reason}` : `Restores v${version}.`,
			proposedConfig: proposed,
			sourceVersion: version,
		});
	},

	async get(id, profile) {
		assertCan(profile, "changeRequest:read");
		const { changeRequest, project, flag, currentVersion } = await load(id, profile);
		const current = flag.environments[changeRequest.environment];
		const impact = await evaluationService
			.impactPreview(project, flag, changeRequest.environment, changeRequest.proposedConfig)
			.catch((error) => ({ error: error.message }));
		return {
			...changeRequest,
			currentVersion,
			diff: diffEnvConfig(current, changeRequest.proposedConfig),
			impact: impact.error
				? impact
				: {
						audienceSize: impact.audienceSize,
						before: impact.before,
						after: impact.after,
						flipped: impact.flipped,
						attribution: impact.attribution,
					},
			flag: {
				_id: flag._id,
				key: flag.key,
				name: flag.name,
				type: flag.type,
				variations: flag.variations,
				archived: flag.archived,
				killSwitch: flag.killSwitch,
			},
			project: { _id: project._id, key: project.key, name: project.name },
			environmentPolicy: environmentOf(project, changeRequest.environment),
			permissions: {
				canReview: can(profile.role, "changeRequest:review") && String(changeRequest.authorId) !== String(profile._id),
				canApply: can(profile.role, "changeRequest:apply", { isAuthor: String(changeRequest.authorId) === String(profile._id) }),
				canEdit: String(changeRequest.authorId) === String(profile._id) && can(profile.role, "changeRequest:editOwn"),
				canWithdraw:
					(String(changeRequest.authorId) === String(profile._id) && can(profile.role, "changeRequest:withdrawOwn")) ||
					can(profile.role, "changeRequest:withdrawAny"),
				canComment: can(profile.role, "changeRequest:comment") && canComment(changeRequest.status),
			},
		};
	},

	async edit(id, patch, profile) {
		const { changeRequest, project, flag, currentVersion } = await load(id, profile);
		const fields = {};
		if (patch.title !== undefined) fields.title = patch.title;
		if (patch.description !== undefined) fields.description = patch.description;
		if (patch.proposedConfig !== undefined) fields.proposedConfig = await validated(project, flag, patch.proposedConfig);
		const next = transition(changeRequest, "edit", profile, new Date(), { currentVersion, patch: fields });
		const saved = await changeRequestRepository.save(changeRequest._id, next);
		await audit(profile, "changeRequest.edited", saved, `${profile.name} edited "${saved.title}".`, { fields: Object.keys(fields) });
		return saved;
	},

	async review(id, { decision, comment }, profile) {
		const { changeRequest, currentVersion } = await load(id, profile);
		const next = transition(changeRequest, decision, profile, new Date(), { currentVersion, comment });
		const saved = await changeRequestRepository.save(changeRequest._id, next);
		await audit(
			profile,
			decision === "approve" ? "changeRequest.approved" : "changeRequest.rejected",
			saved,
			`${profile.name} ${decision === "approve" ? "approved" : "rejected"} "${saved.title}"${comment ? `: ${comment}` : "."}`,
			{
				status: saved.status,
				comment: comment || "",
			},
		);
		return saved;
	},

	async apply(id, { acknowledgeActiveRollout } = {}, profile) {
		const { changeRequest, project, flag, currentVersion, becameConflicted } = await load(id, profile);
		if (becameConflicted) throw conflictError(changeRequest);
		const environment = environmentOf(project, changeRequest.environment);
		const now = new Date();
		const decided = transition(changeRequest, "apply", profile, now, { currentVersion });
		if (decided.status === "conflicted") return this.markConflicted(changeRequest, profile);
		assertNoActiveRollout(await activeRolloutFor(flag, environment.key), acknowledgeActiveRollout);
		let written;
		try {
			written = await flagService.writeVersion(flag, environment.key, changeRequest.proposedConfig, {
				actorId: profile._id,
				source: "changeRequest",
				reason: changeRequest.title,
				audit: false,
				changeRequestId: changeRequest._id,
				expectedVersion: changeRequest.baseVersion,
			});
		} catch (error) {
			if (error.code === "VERSION_CONFLICT") return this.markConflicted(changeRequest, profile);
			throw error;
		}
		const applied = transition(changeRequest, "apply", profile, now, { currentVersion, appliedVersion: written.version.version });
		const saved = await changeRequestRepository.save(changeRequest._id, applied);
		// Exactly one audit entry for the apply: the version write above passed `audit: false`.
		await audit(
			profile,
			"changeRequest.applied",
			saved,
			`${profile.name} applied "${saved.title}" to ${flag.key} in ${environment.name} (v${saved.appliedVersion}).`,
			{
				appliedVersion: saved.appliedVersion,
			},
		);
		return { ...saved, flag: written.flag };
	},

	// The guarded write lost the race: the request is conflicted and the caller learns why.
	async markConflicted(changeRequest, profile) {
		const saved = await changeRequestRepository.save(changeRequest._id, { ...changeRequest, status: "conflicted" });
		await audit(
			profile,
			"changeRequest.conflicted",
			saved,
			`"${saved.title}" conflicts with a newer version of ${saved.flagKey} in ${saved.environment}.`,
			{
				baseVersion: saved.baseVersion,
			},
		);
		throw conflictError(saved);
	},

	async rebase(id, profile) {
		const { changeRequest, project, flag, currentVersion } = await load(id, profile);
		const next = transition(changeRequest, "rebase", profile, new Date(), { currentVersion });
		next.proposedConfig = await validated(project, flag, changeRequest.proposedConfig);
		const saved = await changeRequestRepository.save(changeRequest._id, next);
		await audit(profile, "changeRequest.rebased", saved, `${profile.name} rebased "${saved.title}" onto v${saved.baseVersion}.`, {
			baseVersion: saved.baseVersion,
		});
		return saved;
	},

	async withdraw(id, profile) {
		const { changeRequest } = await load(id, profile);
		const next = transition(changeRequest, "withdraw", profile, new Date(), {});
		const saved = await changeRequestRepository.save(changeRequest._id, next);
		await audit(profile, "changeRequest.withdrawn", saved, `${profile.name} withdrew "${saved.title}".`);
		return saved;
	},

	async addComment(id, body, profile) {
		assertCan(profile, "changeRequest:comment");
		const { changeRequest } = await load(id, profile);
		if (!canComment(changeRequest.status)) throw new AppError(422, "INVALID_TRANSITION", "Comments are closed.");
		const comment = { id: shortId("c"), authorId: profile._id, body, at: new Date() };
		const saved = await changeRequestRepository.save(changeRequest._id, {
			...changeRequest,
			comments: [...changeRequest.comments, comment],
		});
		await audit(profile, "changeRequest.commented", saved, `${profile.name} commented on "${saved.title}".`, { commentId: comment.id });
		return saved;
	},

	openForFlag: (flagId) => changeRequestRepository.findOpen({ flagId }),
};
