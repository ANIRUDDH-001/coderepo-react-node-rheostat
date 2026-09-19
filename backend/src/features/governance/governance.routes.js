import { Router } from "express";
import {
	compareEnvironments,
	previewImpact,
	promoteEnvironment,
	rollbackEnvironment,
	updateEnvironmentConfig,
} from "./governance.controller.js";

// Mounted at /projects/:projectKey/flags/:flagKey/environments/:environment, ahead of the flags router.
export const governanceRouter = Router({ mergeParams: true });
governanceRouter.patch("/", updateEnvironmentConfig);
governanceRouter.get("/compare", compareEnvironments);
governanceRouter.post("/promote", promoteEnvironment);
governanceRouter.post("/rollback", rollbackEnvironment);
governanceRouter.post("/impact", previewImpact);
