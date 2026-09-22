import { z } from "zod";
import { keySchema, objectIdSchema } from "../../shared/utils/keys.js";
import { personService } from "../people/person.service.js";
import { ENVIRONMENT_KEYS } from "../projects/project.model.js";
import { projectService } from "../projects/project.service.js";
import { WEBHOOK_EVENTS } from "./events-catalogue.js";
import { DELIVERY_STATUSES } from "./webhook-delivery.model.js";

const urlSchema = z
	.string()
	.trim()
	.max(500)
	.refine((value) => {
		try {
			const url = new URL(value);
			return url.protocol === "http:" || url.protocol === "https:";
		} catch {
			return false;
		}
	}, "Enter an absolute http(s) URL.");
export const createSchema = z
	.object({
		name: z.string().trim().min(1).max(80),
		url: urlSchema,
		events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
		environments: z.array(z.enum(ENVIRONMENT_KEYS)).default([]),
	})
	.strict();
export const updateSchema = z
	.object({
		name: z.string().trim().min(1).max(80).optional(),
		url: urlSchema.optional(),
		events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
		environments: z.array(z.enum(ENVIRONMENT_KEYS)).optional(),
		enabled: z.boolean().optional(),
		rotateSecret: z.boolean().optional(),
	})
	.strict()
	.refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");
export const deliveriesSchema = z.object({
	status: z.enum(DELIVERY_STATUSES).optional(),
	cursor: z.string().max(80).optional(),
	limit: z.coerce.number().int().min(1).max(100).default(25),
});

const id = (request) => objectIdSchema.parse(request.params.id);

// Handlers are built from a service so HTTP tests can run against fakes. `people` decorates creators.
export function createWebhookHandlers(service, { projects = projectService, people = personService } = {}) {
	const wrap = (fn) => (request, response, next) => Promise.resolve(fn(request, response)).catch(next);
	return {
		list: wrap(async (request, response) => {
			const project = await projects.getByKey(request.params.projectKey);
			const page = await service.list(project, request.profile);
			response.json({ data: { ...page, items: await people.attachActors(page.items, "createdBy", "createdByPerson") } });
		}),
		create: wrap(async (request, response) => {
			const input = createSchema.parse(request.body);
			const project = await projects.getByKey(request.params.projectKey);
			response.status(201).json({ data: await service.create(project, input, request.profile) });
		}),
		get: wrap(async (request, response) => response.json({ data: await service.get(id(request), request.profile) })),
		update: wrap(async (request, response) =>
			response.json({ data: await service.update(id(request), updateSchema.parse(request.body), request.profile) }),
		),
		remove: wrap(async (request, response) => {
			await service.remove(id(request), request.profile);
			response.status(204).end();
		}),
		deliveries: wrap(async (request, response) =>
			response.json({ data: await service.deliveries(id(request), deliveriesSchema.parse(request.query), request.profile) }),
		),
		test: wrap(async (request, response) => response.json({ data: await service.test(id(request), request.profile) })),
		getDelivery: wrap(async (request, response) => response.json({ data: await service.getDelivery(id(request), request.profile) })),
		redeliver: wrap(async (request, response) => response.json({ data: await service.redeliver(id(request), request.profile) })),
		receipts: wrap(async (request, response) =>
			response.json({ data: await service.receipts(await projects.getByKey(request.params.projectKey), request.profile) }),
		),
		clearReceipts: wrap(async (request, response) => {
			await service.clearReceipts(await projects.getByKey(request.params.projectKey), request.profile);
			response.status(204).end();
		}),
	};
}
