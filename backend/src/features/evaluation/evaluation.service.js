import { AppError } from "../../shared/errors/app-error.js";
import { assertCan } from "../../shared/auth/permissions.js";
import { normalizeConfig } from "../flags/config-diff.js";
import { validateEnvConfig } from "../flags/config-validation.js";
import { flagService } from "../flags/flag.service.js";
import { environmentOf } from "../projects/project.service.js";
import { segmentService } from "../segments/segment.service.js";
import { audienceMemberRepository } from "./audience-member.repository.js";
import { evaluationLogRepository } from "./evaluation-log.repository.js";
import { evaluate } from "./evaluator.js";
import { summarizeImpact } from "./impact.js";

export const evaluationService = {
	// Playground: evaluates the active flags (or the requested subset) and records one log per flag.
	async evaluate(project, { environment: environmentKey, context, flagKeys }, profile) {
		assertCan(profile, "playground:evaluate");
		const environment = environmentOf(project, environmentKey);
		const [flags, segmentsByKey] = await Promise.all([
			flagService.findActiveByProject(project._id),
			segmentService.mapByKey(project._id),
		]);
		const selected = flagKeys?.length ? flags.filter((flag) => flagKeys.includes(flag.key)) : flags;
		if (flagKeys?.length) {
			const known = new Set(selected.map((flag) => flag.key));
			const missing = flagKeys.filter((key) => !known.has(key));
			if (missing.length)
				throw new AppError(404, "FLAG_NOT_FOUND", `Unknown or archived flags: ${missing.join(", ")}.`, { flagKeys: missing });
		}
		const at = new Date();
		const results = selected.map((flag) => {
			const outcome = evaluate(flag, environment.key, context, segmentsByKey);
			return { flagKey: flag.key, flagId: flag._id, name: flag.name, type: flag.type, ...outcome };
		});
		if (results.length) {
			await evaluationLogRepository.insertMany(
				results.map((result) => ({
					projectId: project._id,
					flagId: result.flagId,
					flagKey: result.flagKey,
					environment: environment.key,
					contextKey: context.key,
					variationId: result.variationId,
					reasonKind: result.reason.kind,
					source: "playground",
					at,
				})),
			);
		}
		return { environment: environment.key, context, evaluatedAt: at, results: results.map(({ flagId, ...rest }) => rest) };
	},

	// Side-effect-free: evaluates the whole audience against the current and the proposed configuration.
	async impactPreview(project, flag, environmentKey, proposedConfig) {
		const environment = environmentOf(project, environmentKey);
		const segmentsByKey = await segmentService.mapByKey(project._id);
		validateEnvConfig(proposedConfig, flag, new Set(Object.keys(segmentsByKey)));
		const audience = await audienceMemberRepository.findAll(project._id);
		const proposedFlag = { ...flag, environments: { ...flag.environments, [environment.key]: normalizeConfig(proposedConfig) } };
		return {
			environment: environment.key,
			currentVersion: flag.environments[environment.key].version,
			...summarizeImpact(
				audience,
				(context) => evaluate(flag, environment.key, context, segmentsByKey),
				(context) => evaluate(proposedFlag, environment.key, context, segmentsByKey),
			),
		};
	},

	listAudience: (project, { search, limit }) => audienceMemberRepository.search(project._id, search, limit),
};
