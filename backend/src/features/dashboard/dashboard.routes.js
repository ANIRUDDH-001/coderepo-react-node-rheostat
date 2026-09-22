import { Router } from "express";
import { getDashboard } from "./dashboard.controller.js";

// Mounted at /projects/:projectKey/dashboard
export const dashboardRouter = Router({ mergeParams: true });
dashboardRouter.get("/", getDashboard);
