import { z } from "zod";
import { envConfigSchema } from "../../shared/validation/clause.schema.js";
import { evaluationService } from "../evaluation/evaluation.service.js";
import { flagService } from "../flags/flag.service.js";
import { ENVIRONMENT_KEYS } from "../projects/project.model.js";
import { projectService } from "../projects/project.service.js";
import { governanceService } from "./governance.service.js";

const environmentSchema = z.enum(ENVIRONMENT_KEYS);
const acknowledge = z.boolean().default(false);
const updateSchema = z
	.object({
		config: envConfigSchema,
		expectedVersion: z.number().int().min(1),
		reason: z.string().trim().max(200).default(""),
		acknowledgeActiveRollout: acknowledge,
	})
	.strict();
const compareSchema = z.object({ source: environmentSchema });
const promoteSchema = z.object({ source: environmentSchema, acknowledgeActiveRollout: acknowledge }).strict();
const rollbackSchema = z.object({ version: z.number().int().min(1), acknowledgeActiveRollout: acknowledge }).strict();
const impactSchema = z.object({ proposedConfig: envConfigSchema }).strict();

const scope = async (request) => ({
	project: await projectService.getByKey(request.params.projectKey),
	flagKey: request.params.flagKey,
	environment: environmentSchema.parse(request.params.environment),
});

export async function updateEnvironmentConfig(request, response, next) {
	try {
		const input = updateSchema.parse(request.body);
		const { project, flagKey, environment } = await scope(request);
		response.json({ data: await governanceService.updateEnvironmentConfig(project, flagKey, environment, input, request.profile) });
	} catch (error) {
		next(error);
	}
}

export async function compareEnvironments(request, response, next) {
	try {
		const { source } = compareSchema.parse(request.query);
		const { project, flagKey, environment } = await scope(request);
		response.json({ data: await governanceService.compare(project, flagKey, environment, source) });
	} catch (error) {
		next(error);
	}
}

export async function promoteEnvironment(request, response, next) {
	try {
		const input = promoteSchema.parse(request.body);
		const { project, flagKey, environment } = await scope(request);
		const result = await governanceService.promote(project, flagKey, environment, input, request.profile);
		response.status(result.kind === "changeRequest" ? 201 : 200).json({ data: result });
	} catch (error) {
		next(error);
	}
}

export async function rollbackEnvironment(request, response, next) {
	try {
		const input = rollbackSchema.parse(request.body);
		const { project, flagKey, environment } = await scope(request);
		const result = await governanceService.rollback(project, flagKey, environment, input, request.profile);
		response.status(result.kind === "changeRequest" ? 201 : 200).json({ data: result });
	} catch (error) {
		next(error);
	}
}

export async function previewImpact(request, response, next) {
	try {
		const { proposedConfig } = impactSchema.parse(request.body);
		const { project, flagKey, environment } = await scope(request);
		const flag = await flagService.getRawByKey(project, flagKey);
		response.json({ data: await evaluationService.impactPreview(project, flag, environment, proposedConfig) });
	} catch (error) {
		next(error);
	}
}
