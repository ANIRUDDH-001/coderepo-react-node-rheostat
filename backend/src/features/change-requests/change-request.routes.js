import { Router } from "express";
import {
	applyChangeRequest,
	commentOnChangeRequest,
	createChangeRequest,
	editChangeRequest,
	getChangeRequest,
	listChangeRequests,
	rebaseChangeRequest,
	reviewChangeRequest,
	withdrawChangeRequest,
} from "./change-request.controller.js";

// Project-scoped list and create: /projects/:projectKey/change-requests
export const projectChangeRequestRouter = Router({ mergeParams: true });
projectChangeRequestRouter.get("/", listChangeRequests);
projectChangeRequestRouter.post("/", createChangeRequest);

// Request-scoped actions: /change-requests/:id
export const changeRequestRouter = Router();
changeRequestRouter.get("/:id", getChangeRequest);
changeRequestRouter.patch("/:id", editChangeRequest);
changeRequestRouter.post("/:id/review", reviewChangeRequest);
changeRequestRouter.post("/:id/apply", applyChangeRequest);
changeRequestRouter.post("/:id/rebase", rebaseChangeRequest);
changeRequestRouter.post("/:id/withdraw", withdrawChangeRequest);
changeRequestRouter.post("/:id/comments", commentOnChangeRequest);
