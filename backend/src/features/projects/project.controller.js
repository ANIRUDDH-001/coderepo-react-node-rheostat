import { z } from "zod";
import { keySchema } from "../../shared/utils/keys.js";
import { ENVIRONMENT_KEYS } from "./project.model.js";
import { projectService } from "./project.service.js";

const createSchema = z
	.object({ key: keySchema, name: z.string().trim().min(1).max(80), description: z.string().trim().max(500).default("") })
	.strict();
const environmentPatchSchema = z
	.object({
		key: z.enum(ENVIRONMENT_KEYS),
		name: z.string().trim().min(1).max(60).optional(),
		color: z
			.string()
			.regex(/^#[0-9A-Fa-f]{6}$/)
			.optional(),
		protected: z.boolean().optional(),
		requiredApprovals: z.number().int().min(1).max(3).optional(),
	})
	.strict();
const updateSchema = z
	.object({
		name: z.string().trim().min(1).max(80).optional(),
		description: z.string().trim().max(500).optional(),
		environments: z.array(environmentPatchSchema).min(1).max(3).optional(),
	})
	.strict()
	.refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");

export async function listProjects(request, response, next) {
	try {
		response.json({ data: await projectService.list() });
	} catch (error) {
		next(error);
	}
}

export async function getProject(request, response, next) {
	try {
		response.json({ data: await projectService.getByKey(request.params.projectKey) });
	} catch (error) {
		next(error);
	}
}

export async function createProject(request, response, next) {
	try {
		response.status(201).json({ data: await projectService.create(createSchema.parse(request.body), request.profile) });
	} catch (error) {
		next(error);
	}
}

export async function updateProject(request, response, next) {
	try {
		response.json({ data: await projectService.update(request.params.projectKey, updateSchema.parse(request.body), request.profile) });
	} catch (error) {
		next(error);
	}
}
