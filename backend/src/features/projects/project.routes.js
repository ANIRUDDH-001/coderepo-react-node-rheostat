import { Router } from "express";
import { createProject, getProject, listProjects, updateProject } from "./project.controller.js";

export const projectRouter = Router();
projectRouter.get("/", listProjects);
projectRouter.post("/", createProject);
projectRouter.get("/:projectKey", getProject);
projectRouter.patch("/:projectKey", updateProject);
