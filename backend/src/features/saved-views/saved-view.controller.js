import { z } from "zod";
import { objectIdSchema } from "../../shared/utils/keys.js";
import { ENVIRONMENT_KEYS } from "../projects/project.model.js";
import { projectService } from "../projects/project.service.js";
import { savedViewService } from "./saved-view.service.js";

const filtersSchema = z
	.object({
		query: z.string().trim().max(100).optional(),
		environment: z.enum(ENVIRONMENT_KEYS).or(z.literal("")).optional(),
		state: z.enum(["any", "on", "off"]).optional(),
		tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
		type: z.enum(["boolean", "string", "number", "json"]).or(z.literal("")).optional(),
		lifecycle: z.enum(["temporary", "permanent"]).or(z.literal("")).optional(),
		stale: z.enum(["any", "readyToRemove", "overdue"]).optional(),
		ownerId: objectIdSchema.or(z.literal("")).optional(),
		archived: z.boolean().optional(),
	})
	.strict();
const sortSchema = z.enum(["updated", "name", "key", "stale"]);
const nameSchema = z.string().trim().min(1).max(60);
const createSchema = z.object({ name: nameSchema, filters: filtersSchema.default({}), sort: sortSchema.optional() }).strict();
const updateSchema = z
	.object({ name: nameSchema.optional(), filters: filtersSchema.optional(), sort: sortSchema.optional() })
	.strict()
	.refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");

export async function listSavedViews(request, response, next) {
	try {
		const project = await projectService.getByKey(request.params.projectKey);
		response.json({ data: await savedViewService.list(project, request.profile) });
	} catch (error) {
		next(error);
	}
}

export async function createSavedView(request, response, next) {
	try {
		const input = createSchema.parse(request.body);
		const project = await projectService.getByKey(request.params.projectKey);
		response.status(201).json({ data: await savedViewService.create(project, input, request.profile) });
	} catch (error) {
		next(error);
	}
}

export async function updateSavedView(request, response, next) {
	try {
		response.json({ data: await savedViewService.update(request.params.id, updateSchema.parse(request.body), request.profile) });
	} catch (error) {
		next(error);
	}
}

export async function deleteSavedView(request, response, next) {
	try {
		await savedViewService.remove(request.params.id, request.profile);
		response.status(204).end();
	} catch (error) {
		next(error);
	}
}
