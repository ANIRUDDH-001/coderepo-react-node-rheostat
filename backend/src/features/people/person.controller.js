import { z } from "zod";
import { ROLES } from "../../shared/auth/permissions.js";
import { personService } from "./person.service.js";

const searchSchema = z.object({ search: z.string().trim().max(100).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) });
const roleSchema = z.object({ role: z.enum(ROLES) }).strict();

export async function listProfiles(request, response, next) {
	try {
		response.json({ data: await personService.listProfiles() });
	} catch (error) {
		next(error);
	}
}

export async function searchPeople(request, response, next) {
	try {
		const { search, limit } = searchSchema.parse(request.query);
		response.json({ data: await personService.search(search || "", limit) });
	} catch (error) {
		next(error);
	}
}

export async function updateRole(request, response, next) {
	try {
		const { role } = roleSchema.parse(request.body);
		response.json({ data: await personService.updateRole(request.params.personId, role, request.profile) });
	} catch (error) {
		next(error);
	}
}
