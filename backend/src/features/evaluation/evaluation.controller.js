import { z } from "zod";
import { keySchema } from "../../shared/utils/keys.js";
import { ENVIRONMENT_KEYS } from "../projects/project.model.js";
import { projectService } from "../projects/project.service.js";
import { evaluationService } from "./evaluation.service.js";

const attributeValue = z.union([z.string().max(200), z.number().finite(), z.boolean()]);
const contextSchema = z
	.object({
		key: z.string().trim().min(1).max(120),
		attributes: z
			.record(z.string().min(1).max(60), attributeValue)
			.default({})
			.refine((value) => Object.keys(value).length <= 30, "Provide at most 30 attributes."),
	})
	.strict();
const evaluateSchema = z
	.object({ environment: z.enum(ENVIRONMENT_KEYS), context: contextSchema, flagKeys: z.array(keySchema).max(100).optional() })
	.strict();
const audienceSchema = z.object({
	search: z.string().trim().max(100).optional(),
	limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function evaluateFlags(request, response, next) {
	try {
		const input = evaluateSchema.parse(request.body);
		const project = await projectService.getByKey(request.params.projectKey);
		response.json({ data: await evaluationService.evaluate(project, input, request.profile) });
	} catch (error) {
		next(error);
	}
}

export async function listAudience(request, response, next) {
	try {
		const query = audienceSchema.parse(request.query);
		const project = await projectService.getByKey(request.params.projectKey);
		response.json({ data: await evaluationService.listAudience(project, query) });
	} catch (error) {
		next(error);
	}
}
