import { z } from "zod";
import { objectIdSchema } from "../../shared/utils/keys.js";
import { personService } from "../people/person.service.js";
import { authService } from "./auth.service.js";

const loginSchema = z
	.object({
		email: z
			.email()
			.max(254)
			.transform((value) => value.toLowerCase()),
		password: z.string().min(1).max(200),
	})
	.strict();
const switchSchema = z.object({ profileId: objectIdSchema }).strict();

export async function login(request, response, next) {
	try {
		const { email, password } = loginSchema.parse(request.body);
		response.json({ data: await authService.login(email, password) });
	} catch (error) {
		next(error);
	}
}

export async function session(request, response, next) {
	try {
		const profileId = request.auth?.profileId;
		const profile = profileId ? await personService.findProfileById(profileId) : null;
		response.json({ data: authService.session(request.account, profile) });
	} catch (error) {
		next(error);
	}
}

export async function switchProfile(request, response, next) {
	try {
		const { profileId } = switchSchema.parse(request.body);
		response.json({ data: await authService.switchProfile(request.account, profileId) });
	} catch (error) {
		next(error);
	}
}

export function logout(request, response) {
	response.status(204).end();
}
