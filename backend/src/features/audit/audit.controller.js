import { z } from "zod";
import { objectIdSchema } from "../../shared/utils/keys.js";
import { personService } from "../people/person.service.js";
import { projectService } from "../projects/project.service.js";
import { auditService } from "./audit.service.js";

const listSchema = z.object({
	projectKey: z.string().trim().max(40).optional(),
	entityType: z.string().trim().max(40).optional(),
	actorId: objectIdSchema.optional(),
	before: z.coerce.date().optional(),
	limit: z.coerce.number().int().min(1).max(100).default(25),
});

export async function listAudit(request, response, next) {
	try {
		const query = listSchema.parse(request.query);
		const projectId = query.projectKey ? (await projectService.getByKey(query.projectKey))._id : null;
		const page = await auditService.list({ ...query, projectId });
		response.json({ data: { ...page, items: await personService.attachActors(page.items) } });
	} catch (error) {
		next(error);
	}
}
