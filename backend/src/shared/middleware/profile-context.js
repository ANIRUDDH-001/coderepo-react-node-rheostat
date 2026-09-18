import mongoose from "mongoose";
import { AppError } from "../errors/app-error.js";
import { personService } from "../../features/people/person.service.js";

export async function resolveProfileContext(request, response, next) {
	try {
		const profileId = request.auth?.profileId || "";
		if (!profileId) throw new AppError(401, "PROFILE_REQUIRED", "Select a Rheostat profile to continue.");
		if (!mongoose.isValidObjectId(profileId)) throw new AppError(401, "INVALID_PROFILE", "Select a valid Rheostat profile.");
		if (!request.account.allowedProfileIds.some((id) => String(id) === String(profileId))) {
			throw new AppError(403, "PROFILE_FORBIDDEN", "This profile is not available in the current workspace.");
		}
		const profile = await personService.findProfileById(profileId);
		if (!profile) throw new AppError(401, "PROFILE_NOT_FOUND", "This Rheostat profile is no longer available.");
		request.profileId = String(profile._id);
		request.profile = profile;
		next();
	} catch (error) {
		next(error);
	}
}
