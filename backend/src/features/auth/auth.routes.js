import { Router } from "express";
import { login, logout, session, switchProfile } from "./auth.controller.js";
import { requireWorkspaceAuth } from "../../shared/middleware/auth.js";
import { createRateLimiter } from "../../shared/middleware/rate-limit.js";

// Ten attempts per address and email per quarter hour (hardening spec §2).
export const loginLimiter = createRateLimiter({
	name: "login",
	windowMs: 15 * 60 * 1000,
	max: 10,
	keyFor: (request) => `${request.ip}:${String(request.body?.email || "")
		.trim()
		.toLowerCase()}`,
});

export const authRouter = Router();
authRouter.post("/login", loginLimiter, login);
authRouter.get("/session", requireWorkspaceAuth, session);
authRouter.post("/switch-profile", requireWorkspaceAuth, switchProfile);
authRouter.post("/logout", requireWorkspaceAuth, logout);
