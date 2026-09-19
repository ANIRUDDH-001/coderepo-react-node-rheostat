import { z } from "zod";
import { keySchema, objectIdSchema } from "../../shared/utils/keys.js";
import { paginate } from "../../shared/utils/pagination.js";
import { personService } from "../people/person.service.js";
import { ENVIRONMENT_KEYS } from "../projects/project.model.js";
import { projectService } from "../projects/project.service.js";
import { PLAN_STATUSES } from "./plan.js";
import { rolloutService } from "./rollout.service.js";

const listSchema = z.object({ status: z.enum([...PLAN_STATUSES, "active"]).optional(), flagKey: keySchema.optional() });
const stepSchema = z.object({ percent: z.number().int().min(1).max(100), startAt: z.string().datetime({ offset: true }) }).strict();
const createSchema = z
	.object({
		flagKey: keySchema,
		environment: z.enum(ENVIRONMENT_KEYS),
		targetVariationId: z.string().min(1),
		baselineVariationId: z.string().min(1),
		bucketBy: z.string().trim().min(1).max(60).regex(/^[A-Za-z][A-Za-z0-9_.-]*$/, "Bucket attribute must be an attribute name.").default("key"),
		steps: z.array(stepSchema).min(1).max(12),
	})
	.strict();

const decorate = async (plan) => ({ ...plan, createdByPerson: (await personService.findMany([plan.createdBy]))[0] || null });
const id = (request) => objectIdSchema.parse(request.params.id);
const respond = (response, status, promise, next) =>
	promise.then(async (data) => response.status(status).json({ data: await decorate(data) })).catch(next);

export async function listRollouts(request, response, next) {
	try {
		const filters = { ...listSchema.parse(request.query), ...paginate(request.query) };
		const project = await projectService.getByKey(request.params.projectKey);
		const page = await rolloutService.list(project, filters, request.profile);
		response.json({ data: { ...page, items: await personService.attachActors(page.items, "createdBy", "createdByPerson") } });
	} catch (error) {
		next(error);
	}
}

export async function createRollout(request, response, next) {
	try {
		const input = createSchema.parse(request.body);
		const project = await projectService.getByKey(request.params.projectKey);
		await respond(response, 201, rolloutService.create(project, input, request.profile), next);
	} catch (error) {
		next(error);
	}
}

export const getRollout = (request, response, next) => {
	try {
		respond(response, 200, rolloutService.get(id(request), request.profile), next);
	} catch (error) {
		next(error);
	}
};
export const pauseRollout = (request, response, next) => {
	try {
		respond(response, 200, rolloutService.pause(id(request), request.profile), next);
	} catch (error) {
		next(error);
	}
};
export const resumeRollout = (request, response, next) => {
	try {
		respond(response, 200, rolloutService.resume(id(request), request.profile), next);
	} catch (error) {
		next(error);
	}
};
export const abortRollout = (request, response, next) => {
	try {
		respond(response, 200, rolloutService.abort(id(request), request.profile), next);
	} catch (error) {
		next(error);
	}
};
