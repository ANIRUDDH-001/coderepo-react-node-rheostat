import { Router } from "express";
import { listProfiles, searchPeople, updateRole } from "./person.controller.js";

export const profileRouter = Router();
profileRouter.get("/", listProfiles);

export const personRouter = Router();
personRouter.get("/", searchPeople);
personRouter.patch("/:personId/role", updateRole);
