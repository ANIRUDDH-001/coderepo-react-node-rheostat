import { z } from "zod";
import { keySchema } from "../../shared/utils/keys.js";
import { clauseSchema } from "../../shared/validation/clause.schema.js";
import { projectService } from "../projects/project.service.js";
import { segmentService } from "./segment.service.js";

const segmentRuleSchema = z
	.object({
		id: z.string().min(1).max(40).optional(),
		description: z.string().trim().max(200).default(""),
		clauses: z.array(clauseSchema).min(1).max(10),
	})
	.strict();
const keyList = z.array(z.string().trim().min(1).max(120)).max(200);
const createSchema = z
	.object({
		key: keySchema,
		name: z.string().trim().min(1).max(80),
		description: z.string().trim().max(500).default(""),
		rules: z.array(segmentRuleSchema).max(25).default([]),
		includedKeys: keyList.default([]),
		excludedKeys: keyList.default([]),
	})
	.strict();
const updateSchema = createSchema
	.omit({ key: true })
	.partial()
	.strict()
	.refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");

const loadProject = (request) => projectService.getByKey(request.params.projectKey);

export async function listSegments(request, response, next) {
	try {
		const project = await loadProject(request);
		response.json({ data: await segmentService.listByProject(project) });
	} catch (error) {
		next(error);
	}
}

export async function getSegment(request, response, next) {
	try {
		const project = await loadProject(request);
		response.json({ data: await segmentService.getByKey(project, request.params.segmentKey) });
	} catch (error) {
		next(error);
	}
}

export async function createSegment(request, response, next) {
	try {
		const input = createSchema.parse(request.body);
		const project = await loadProject(request);
		response.status(201).json({ data: await segmentService.create(project, input, request.profile) });
	} catch (error) {
		next(error);
	}
}

export async function updateSegment(request, response, next) {
	try {
		const input = updateSchema.parse(request.body);
		const project = await loadProject(request);
		response.json({ data: await segmentService.update(project, request.params.segmentKey, input, request.profile) });
	} catch (error) {
		next(error);
	}
}

export async function deleteSegment(request, response, next) {
	try {
		const project = await loadProject(request);
		await segmentService.remove(project, request.params.segmentKey, request.profile);
		response.status(204).end();
	} catch (error) {
		next(error);
	}
}
