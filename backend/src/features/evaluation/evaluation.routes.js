import { Router } from "express";
import { evaluateFlags, listAudience } from "./evaluation.controller.js";

export const evaluateRouter = Router({ mergeParams: true });
evaluateRouter.post("/", evaluateFlags);

export const audienceRouter = Router({ mergeParams: true });
audienceRouter.get("/", listAudience);
