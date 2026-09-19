import { z } from "zod";
import { keySchema, objectIdSchema } from "../../shared/utils/keys.js";
import { paginate } from "../../shared/utils/pagination.js";
import { envConfigSchema } from "../../shared/validation/clause.schema.js";
import { personService } from "../people/person.service.js";
import { ENVIRONMENT_KEYS } from "../projects/project.model.js";
import { projectService } from "../projects/project.service.js";
import { changeRequestService } from "./change-request.service.js";
import { STATUSES } from "./transitions.js";

const flag = (value) => value === "true" || value === "1";
const listSchema = z.object({
	status: z.enum(STATUSES).optional(),
	flagKey: keySchema.optional(),
	mine: z.preprocess(flag, z.boolean()).optional(),
	needsMyReview: z.preprocess(flag, z.boolean()).optional(),
});
const createSchema = z
	.object({
		flagKey: keySchema,
		environment: z.enum(ENVIRONMENT_KEYS),
		title: z.string().trim().min(3).max(140),
		description: z.string().trim().max(2000).default(""),
		proposedConfig: envConfigSchema,
	})
	.strict();
const editSchema = z
	.object({
		title: z.string().trim().min(3).max(140).optional(),
		description: z.string().trim().max(2000).optional(),
		proposedConfig: envConfigSchema.optional(),
	})
	.strict()
	.refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");
const reviewSchema = z.object({ decision: z.enum(["approve", "reject"]), comment: z.string().trim().max(2000).default("") }).strict();
const applySchema = z.object({ acknowledgeActiveRollout: z.boolean().default(false) }).strict();
const commentSchema = z.object({ body: z.string().trim().min(1).max(2000) }).strict();

// Decorates people everywhere they appear: author, reviewers, commenters, and the applier.
async function decorate(changeRequest) {
	const ids = [
		changeRequest.authorId,
		changeRequest.appliedBy,
		...changeRequest.reviews.map((review) => review.reviewerId),
		...changeRequest.comments.map((comment) => comment.authorId),
	].filter(Boolean);
	const people = await personService.findMany(ids);
	const byId = new Map(people.map((person) => [String(person._id), person]));
	const person = (id) => (id ? byId.get(String(id)) || null : null);
	return {
		...changeRequest,
		author: person(changeRequest.authorId),
		appliedByPerson: person(changeRequest.appliedBy),
		reviews: changeRequest.reviews.map((review) => ({ ...review, reviewer: person(review.reviewerId) })),
		comments: changeRequest.comments.map((comment) => ({ ...comment, author: person(comment.authorId) })),
	};
}

const id = (request) => objectIdSchema.parse(request.params.id);
const respond = (response, status, promise, next) =>
	promise.then(async (data) => response.status(status).json({ data: await decorate(data) })).catch(next);

export async function listChangeRequests(request, response, next) {
	try {
		const filters = { ...listSchema.parse(request.query), ...paginate(request.query) };
		const project = await projectService.getByKey(request.params.projectKey);
		const page = await changeRequestService.list(project, filters, request.profile);
		response.json({ data: { ...page, items: await Promise.all(page.items.map(decorate)) } });
	} catch (error) {
		next(error);
	}
}

export async function createChangeRequest(request, response, next) {
	try {
		const input = createSchema.parse(request.body);
		const project = await projectService.getByKey(request.params.projectKey);
		respond(response, 201, changeRequestService.create(project, input, request.profile), next);
	} catch (error) {
		next(error);
	}
}

export const getChangeRequest = (request, response, next) => {
	try {
		respond(response, 200, changeRequestService.get(id(request), request.profile), next);
	} catch (error) {
		next(error);
	}
};

export const editChangeRequest = (request, response, next) => {
	try {
		respond(response, 200, changeRequestService.edit(id(request), editSchema.parse(request.body), request.profile), next);
	} catch (error) {
		next(error);
	}
};

export const reviewChangeRequest = (request, response, next) => {
	try {
		respond(response, 200, changeRequestService.review(id(request), reviewSchema.parse(request.body), request.profile), next);
	} catch (error) {
		next(error);
	}
};

export const applyChangeRequest = (request, response, next) => {
	try {
		respond(response, 200, changeRequestService.apply(id(request), applySchema.parse(request.body ?? {}), request.profile), next);
	} catch (error) {
		next(error);
	}
};

export const rebaseChangeRequest = (request, response, next) => {
	try {
		respond(response, 200, changeRequestService.rebase(id(request), request.profile), next);
	} catch (error) {
		next(error);
	}
};

export const withdrawChangeRequest = (request, response, next) => {
	try {
		respond(response, 200, changeRequestService.withdraw(id(request), request.profile), next);
	} catch (error) {
		next(error);
	}
};

export const commentOnChangeRequest = (request, response, next) => {
	try {
		respond(response, 201, changeRequestService.addComment(id(request), commentSchema.parse(request.body).body, request.profile), next);
	} catch (error) {
		next(error);
	}
};
