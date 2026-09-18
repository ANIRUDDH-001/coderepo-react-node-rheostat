import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { AppError } from "../../shared/errors/app-error.js";
import { getConfig } from "../../shared/config/index.js";
import { permissionsFor } from "../../shared/auth/permissions.js";
import { personService, publicPerson } from "../people/person.service.js";
import { authRepository } from "./auth.repository.js";

const ISSUER = "rheostat-api";
const AUDIENCE = "rheostat-app";
const INVALID_TOKEN = () => new AppError(401, "INVALID_TOKEN", "Your Rheostat session is invalid or has expired.");

const publicAccount = (account) => ({ _id: String(account._id), name: account.name, email: account.email });

const sign = (account, profileId) =>
	jwt.sign(
		{ sub: String(account._id), type: profileId ? "profile" : "workspace", ...(profileId ? { profileId: String(profileId) } : {}) },
		getConfig().jwtSecret,
		{ expiresIn: getConfig().jwtExpiresIn, issuer: ISSUER, audience: AUDIENCE },
	);

const allows = (account, profileId) => account.allowedProfileIds.some((id) => String(id) === String(profileId));

export const authService = {
	async login(email, password) {
		const account = await authRepository.findActiveByEmailWithPassword(email.toLowerCase());
		const valid = account ? await bcrypt.compare(password, account.passwordHash) : false;
		if (!valid) throw new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
		return { account: publicAccount(account), token: sign(account) };
	},
	async authenticate(token) {
		let payload;
		try {
			payload = jwt.verify(token, getConfig().jwtSecret, { issuer: ISSUER, audience: AUDIENCE });
		} catch {
			throw INVALID_TOKEN();
		}
		if (!mongoose.isValidObjectId(payload.sub) || !["workspace", "profile"].includes(payload.type)) throw INVALID_TOKEN();
		const account = await authRepository.findActiveById(payload.sub);
		if (!account) throw new AppError(401, "ACCOUNT_UNAVAILABLE", "This Rheostat workspace is no longer available.");
		if (payload.type === "profile" && (!payload.profileId || !allows(account, payload.profileId))) {
			throw new AppError(403, "PROFILE_FORBIDDEN", "This profile is not available in the current workspace.");
		}
		return { account, payload };
	},
	session(account, profile) {
		return { account: publicAccount(account), profile: profile ? publicPerson(profile) : null, permissions: profile ? permissionsFor(profile.role) : [] };
	},
	async switchProfile(account, profileId) {
		if (!allows(account, profileId)) throw new AppError(403, "PROFILE_FORBIDDEN", "This profile is not available in the current workspace.");
		const profile = await personService.findProfileById(profileId);
		if (!profile) throw new AppError(404, "PROFILE_NOT_FOUND", "This Rheostat profile is no longer available.");
		return { profile: publicPerson(profile), permissions: permissionsFor(profile.role), token: sign(account, profileId) };
	},
};
