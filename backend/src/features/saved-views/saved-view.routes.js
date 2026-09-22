import { Router } from "express";
import { createSavedView, deleteSavedView, listSavedViews, updateSavedView } from "./saved-view.controller.js";

// Project-scoped list and create: /projects/:projectKey/saved-views
export const projectSavedViewRouter = Router({ mergeParams: true });
projectSavedViewRouter.get("/", listSavedViews);
projectSavedViewRouter.post("/", createSavedView);

// View-scoped edits: /saved-views/:id
export const savedViewRouter = Router();
savedViewRouter.patch("/:id", updateSavedView);
savedViewRouter.delete("/:id", deleteSavedView);
