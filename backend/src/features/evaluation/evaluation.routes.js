import { Router } from "express";
import { createRateLimiter } from "../../shared/middleware/rate-limit.js";
import { evaluateFlags, listAudience } from "./evaluation.controller.js";

// Sixty playground runs per minute per profile (hardening spec §2).
export const evaluateLimiter = createRateLimiter({ name: "evaluate", windowMs: 60 * 1000, max: 60, keyFor: (request) => request.profileId });

export const evaluateRouter = Router({ mergeParams: true });
evaluateRouter.post("/", evaluateLimiter, evaluateFlags);

export const audienceRouter = Router({ mergeParams: true });
audienceRouter.get("/", listAudience);
