import { AppError } from "../../shared/errors/app-error.js";
import { assertCan, can } from "../../shared/auth/permissions.js";
import { shortId } from "../../shared/utils/keys.js";
import { assertNoActiveRollout } from "../../shared/utils/rollout-guard.js";
import { diffEnvConfig, isEquivalent, normalizeConfig } from "../flags/config-diff.js";
import { validateEnvConfig } from "../flags/config-validation.js";
import { flagService } from "../flags/flag.service.js";
import { environmentOf } from "../projects/project.service.js";
import { segmentService } from "../segments/segment.service.js";
import { governanceDeps } from "./governance.deps.js";

const CHANGE_REQUEST_REQUIRED = (environment) =>
	new AppError(403, "CHANGE_REQUEST_REQUIRED", `${environment.name} is protected. Propose this change through a change request.`, {
		environment: environment.key,
		requiredApprovals: environment.requiredApprovals,
	});

// --- Pure decision helpers (tested without a database) ---

export { assertNoActiveRollout };

export function routeForWrite(environment, profile) {
	if (environment.protected) return "changeRequest";
	return can(profile?.role, "flag:editConfig", { environment }) ? "direct" : "changeRequest";
}

// A configuration copied from another environment or version carries no bookkeeping fields.
export const promotionPayload = (sourceConfig) => normalizeConfig(sourceConfig);

export const withRuleIds = (config) => ({
	...config,
	rules: (config.rules || []).map((rule) => ({ ...rule, id: rule.id || shortId("r") })),
});

// --- Orchestration ---

const activeRolloutFor = (flag, environmentKey) =>
	governanceDeps.rollouts ? governanceDeps.rollouts.activeForFlag(flag._id, environmentKey) : Promise.resolve(null);

const assertEditable = (flag) => {
	if (flag.archived) throw new AppError(422, "INVALID_TRANSITION", "Archived flags cannot be changed. Restore the flag first.");
};

async function validateProposed(project, flag, config) {
	const segments = await segmentService.mapByKey(project._id);
	const proposed = withRuleIds(config);
	validateEnvConfig(proposed, flag, new Set(Object.keys(segments)));
	return proposed;
}

// Role check up front: a protected target needs a proposer, an unprotected one needs a direct editor.
const assertMayWrite = (profile, environment) =>
	assertCan(profile, environment.protected ? "changeRequest:create" : "flag:editConfig", { environment });

// Shared tail of promote/rollback: either write directly or hand off to a change request.
async function commit({ flag, environment, proposed, acknowledgeActiveRollout, direct, changeRequest }) {
	if (environment.protected) {
		if (!governanceDeps.changeRequests) throw CHANGE_REQUEST_REQUIRED(environment);
		return { kind: "changeRequest", changeRequest: await changeRequest() };
	}
	assertNoActiveRollout(await activeRolloutFor(flag, environment.key), acknowledgeActiveRollout);
	const result = await direct(proposed);
	return { kind: "direct", ...result };
}

export const governanceService = {
	async updateEnvironmentConfig(
		project,
		flagKey,
		environmentKey,
		{ config, expectedVersion, reason, acknowledgeActiveRollout },
		profile,
	) {
		const environment = environmentOf(project, environmentKey);
		// Role first (a viewer is forbidden everywhere), then protection (a contributor must propose instead).
		assertCan(profile, "flag:editConfig", { environment: { protected: false } });
		if (environment.protected) throw CHANGE_REQUEST_REQUIRED(environment);
		const flag = await flagService.getRawByKey(project, flagKey);
		assertEditable(flag);
		const proposed = await validateProposed(project, flag, config);
		assertNoActiveRollout(await activeRolloutFor(flag, environment.key), acknowledgeActiveRollout);
		return flagService.writeVersion(flag, environment.key, proposed, {
			actorId: profile._id,
			source: "direct",
			reason,
			expectedVersion,
			audit: {
				actor: profile,
				action: "flag.config.updated",
				summary: `${profile.name} updated ${flag.key} in ${environment.name}${reason ? `: ${reason}` : "."}`,
				metadata: { changes: diffEnvConfig(flag.environments[environment.key], proposed).length },
			},
		});
	},

	async compare(project, flagKey, environmentKey, sourceKey) {
		const target = environmentOf(project, environmentKey);
		const source = environmentOf(project, sourceKey);
		if (target.key === source.key) throw new AppError(400, "VALIDATION_ERROR", "Choose a different source environment.");
		const flag = await flagService.getRawByKey(project, flagKey);
		const targetConfig = flag.environments[target.key];
		const sourceConfig = flag.environments[source.key];
		return {
			target: { environment: target.key, version: targetConfig.version, config: normalizeConfig(targetConfig) },
			source: { environment: source.key, version: sourceConfig.version, config: promotionPayload(sourceConfig) },
			diff: diffEnvConfig(targetConfig, sourceConfig),
			route: routeForWrite(target, { role: "developer" }),
		};
	},

	async promote(project, flagKey, environmentKey, { source: sourceKey, acknowledgeActiveRollout }, profile) {
		const environment = environmentOf(project, environmentKey);
		const source = environmentOf(project, sourceKey);
		if (environment.key === source.key) throw new AppError(400, "VALIDATION_ERROR", "Choose a different source environment.");
		assertMayWrite(profile, environment);
		const flag = await flagService.getRawByKey(project, flagKey);
		assertEditable(flag);
		const current = flag.environments[environment.key];
		const sourceConfig = flag.environments[source.key];
		if (isEquivalent(current, sourceConfig)) {
			throw new AppError(422, "INVALID_TRANSITION", `${environment.name} already matches ${source.name}.`);
		}
		const proposed = await validateProposed(project, flag, promotionPayload(sourceConfig));
		return commit({
			flag,
			environment,
			proposed,
			acknowledgeActiveRollout,
			direct: (payload) =>
				flagService.writeVersion(flag, environment.key, payload, {
					actorId: profile._id,
					source: "promotion",
					reason: `Promoted from ${source.name} (v${sourceConfig.version})`,
					expectedVersion: current.version,
					audit: {
						actor: profile,
						action: "flag.promoted",
						summary: `${profile.name} promoted ${flag.key} from ${source.name} to ${environment.name}.`,
						metadata: { sourceEnvironment: source.key, sourceVersion: sourceConfig.version },
					},
				}),
			changeRequest: () => governanceDeps.changeRequests.createFromPromotion(project, flag, environment.key, source.key, profile),
		});
	},

	async rollback(project, flagKey, environmentKey, { version, acknowledgeActiveRollout }, profile) {
		const environment = environmentOf(project, environmentKey);
		assertMayWrite(profile, environment);
		const flag = await flagService.getRawByKey(project, flagKey);
		assertEditable(flag);
		const current = flag.environments[environment.key];
		if (version === current.version)
			throw new AppError(422, "INVALID_TRANSITION", `Version ${version} is already the current configuration.`);
		const snapshot = await flagService.getVersion(flag, environment.key, version);
		if (isEquivalent(current, snapshot.config)) {
			throw new AppError(422, "INVALID_TRANSITION", `The current configuration is identical to version ${version}.`);
		}
		const proposed = await validateProposed(project, flag, promotionPayload(snapshot.config));
		return commit({
			flag,
			environment,
			proposed,
			acknowledgeActiveRollout,
			direct: (payload) =>
				flagService.writeVersion(flag, environment.key, payload, {
					actorId: profile._id,
					source: "rollback",
					reason: `Rolled back to v${version}`,
					expectedVersion: current.version,
					audit: {
						actor: profile,
						action: "flag.rolledBack",
						summary: `${profile.name} rolled back ${flag.key} in ${environment.name} to v${version}.`,
						metadata: { restoredVersion: version },
					},
				}),
			changeRequest: () => governanceDeps.changeRequests.createFromRollback(project, flag, environment.key, version, profile),
		});
	},
};
