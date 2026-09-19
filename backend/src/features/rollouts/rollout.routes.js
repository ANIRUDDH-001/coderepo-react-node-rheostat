import { Router } from "express";
import { abortRollout, createRollout, getRollout, listRollouts, pauseRollout, resumeRollout } from "./rollout.controller.js";

// Project-scoped list and create: /projects/:projectKey/rollouts
export const projectRolloutRouter = Router({ mergeParams: true });
projectRolloutRouter.get("/", listRollouts);
projectRolloutRouter.post("/", createRollout);

// Plan-scoped reads and transitions: /rollouts/:id
export const rolloutRouter = Router();
rolloutRouter.get("/:id", getRollout);
rolloutRouter.post("/:id/pause", pauseRollout);
rolloutRouter.post("/:id/resume", resumeRollout);
rolloutRouter.post("/:id/abort", abortRollout);
