import { z } from "zod";
import { keySchema, objectIdSchema } from "../../shared/utils/keys.js";
import { paginate } from "../../shared/utils/pagination.js";
import { ENVIRONMENT_KEYS } from "../projects/project.model.js";
import { projectService } from "../projects/project.service.js";
import { personService } from "../people/person.service.js";
import { FLAG_TYPES, variationValueSchema } from "./env-config.js";
import { flagService } from "./flag.service.js";

const csv = (value) =>
	value
		? String(value)
				.split(",")
				.map((item) => item.trim())
				.filter(Boolean)
		: [];
const listSchema = z.object({
	query: z.string().trim().max(100).optional(),
	tags: z.preprocess(csv, z.array(z.string().max(30)).max(10)),
	type: z.enum(FLAG_TYPES).optional(),
	state: z.enum(["any", "on", "off"]).default("any"),
	environment: z.enum(ENVIRONMENT_KEYS).optional(),
	ownerId: objectIdSchema.optional(),
	lifecycle: z.enum(["temporary", "permanent"]).optional(),
	stale: z.enum(["any", "readyToRemove", "overdue"]).default("any"),
	archived: z
		.enum(["true", "false"])
		.default("false")
		.transform((value) => value === "true"),
	sort: z.enum(["updated", "name", "key", "stale"]).default("updated"),
});
const lifecycleSchema = z.object({ kind: z.enum(["temporary", "permanent"]), removeBy: z.coerce.date().nullable().default(null) }).strict();
const variationInputSchema = z
	.object({ id: z.string().max(40).optional(), name: z.string().trim().min(1).max(60), value: z.unknown().optional() })
	.strict();
const createSchema = z
	.object({
		key: keySchema,
		name: z.string().trim().min(1).max(120),
		description: z.string().trim().max(1000).default(""),
		type: z.enum(FLAG_TYPES),
		variations: z
			.array(variationInputSchema.extend({ value: z.unknown() }))
			.max(8)
			.default([]),
		tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
		ownerId: objectIdSchema.optional(),
		lifecycle: lifecycleSchema.default({ kind: "temporary", removeBy: null }),
	})
	.strict()
	.refine((value) => value.type === "boolean" || value.variations.length >= 2, {
		message: "Provide at least two variations.",
		path: ["variations"],
	})
	.superRefine((value, context) => {
		// Variation values must match the declared type; a mismatch is a malformed request, not a semantic conflict.
		const schema = variationValueSchema(value.type);
		value.variations.forEach((variation, index) => {
			if (!schema.safeParse(variation.value).success) {
				context.addIssue({ code: "custom", path: ["variations", index, "value"], message: `Provide a valid ${value.type} value.` });
			}
		});
	});
const metadataSchema = z
	.object({
		name: z.string().trim().min(1).max(120).optional(),
		description: z.string().trim().max(1000).optional(),
		tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
		ownerId: objectIdSchema.nullable().optional(),
		lifecycle: lifecycleSchema.optional(),
		variations: z.array(variationInputSchema).min(2).max(8).optional(),
	})
	.strict()
	.refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");
const killSwitchSchema = z.object({ reason: z.string().trim().min(10).max(300) }).strict();

const respond = (response, status, promise, next) => promise.then((data) => response.status(status).json({ data })).catch(next);
const loadProject = (request) => projectService.getByKey(request.params.projectKey);

export async function listFlags(request, response, next) {
	try {
		const filters = { ...listSchema.parse(request.query), ...paginate(request.query) };
		const project = await loadProject(request);
		const page = await flagService.list(project, filters);
		response.json({ data: { ...page, items: await personService.attachActors(page.items, "ownerId", "owner") } });
	} catch (error) {
		next(error);
	}
}

export async function getFlag(request, response, next) {
	try {
		const project = await loadProject(request);
		const flag = await flagService.getByKey(project, request.params.flagKey);
		const [decorated] = await personService.attachActors([flag], "ownerId", "owner");
		const [killSwitch] = await personService.attachActors([flag.killSwitch]);
		response.json({ data: { ...decorated, killSwitch, activeRollouts: Object.fromEntries(ENVIRONMENT_KEYS.map((key) => [key, null])) } });
	} catch (error) {
		next(error);
	}
}

export async function createFlag(request, response, next) {
	try {
		const project = await loadProject(request);
		respond(response, 201, flagService.create(project, createSchema.parse(request.body), request.profile), next);
	} catch (error) {
		next(error);
	}
}

export async function updateFlagMetadata(request, response, next) {
	try {
		const project = await loadProject(request);
		respond(
			response,
			200,
			flagService.updateMetadata(project, request.params.flagKey, metadataSchema.parse(request.body), request.profile),
			next,
		);
	} catch (error) {
		next(error);
	}
}

export const archiveFlag = (request, response, next) =>
	loadProject(request)
		.then((project) => respond(response, 200, flagService.setArchived(project, request.params.flagKey, true, request.profile), next))
		.catch(next);
export const restoreFlag = (request, response, next) =>
	loadProject(request)
		.then((project) => respond(response, 200, flagService.setArchived(project, request.params.flagKey, false, request.profile), next))
		.catch(next);

export async function listVersions(request, response, next) {
	try {
		const environment = z.enum(ENVIRONMENT_KEYS).parse(request.params.environment);
		const project = await loadProject(request);
		const entries = await flagService.listVersions(project, request.params.flagKey, environment);
		response.json({ data: await personService.attachActors(entries) });
	} catch (error) {
		next(error);
	}
}

export async function activateKillSwitch(request, response, next) {
	try {
		const { reason } = killSwitchSchema.parse(request.body);
		const project = await loadProject(request);
		respond(response, 200, flagService.activateKillSwitch(project, request.params.flagKey, reason, request.profile), next);
	} catch (error) {
		next(error);
	}
}

export const clearKillSwitch = (request, response, next) =>
	loadProject(request)
		.then((project) => respond(response, 200, flagService.clearKillSwitch(project, request.params.flagKey, request.profile), next))
		.catch(next);
