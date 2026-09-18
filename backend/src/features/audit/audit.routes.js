import { Router } from "express";
import { listAudit } from "./audit.controller.js";

export const auditRouter = Router();
auditRouter.get("/", listAudit);
