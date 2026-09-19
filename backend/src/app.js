import cors from "cors";
import express from "express";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";
import { auditRouter } from "./features/audit/audit.routes.js";
import { authRouter } from "./features/auth/auth.routes.js";
import { changeRequestRouter, projectChangeRequestRouter } from "./features/change-requests/change-request.routes.js";
import { audienceRouter, evaluateRouter } from "./features/evaluation/evaluation.routes.js";
import { flagRouter } from "./features/flags/flag.routes.js";
import { governanceRouter } from "./features/governance/governance.routes.js";
import { personRouter, profileRouter } from "./features/people/person.routes.js";
import { projectRouter } from "./features/projects/project.routes.js";
import { projectRolloutRouter, rolloutRouter } from "./features/rollouts/rollout.routes.js";
import { segmentRouter } from "./features/segments/segment.routes.js";
import { errorHandler, notFoundHandler } from "./shared/middleware/error-handler.js";
import { resolveProfileContext } from "./shared/middleware/profile-context.js";
import { requireWorkspaceAuth } from "./shared/middleware/auth.js";

const publicDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");

export function createApp() {
	const app = express();
	app.disable("x-powered-by");
	app.use(cors());
	app.use(express.json({ limit: "200kb" }));
	app.use(express.static(publicDirectory));
	app.get("/api/v1/health", (request, response) => {
		const database = mongoose.connection.readyState === 1 ? "connected" : "disconnected";
		response
			.status(database === "connected" ? 200 : 503)
			.json({ data: { status: database === "connected" ? "ok" : "degraded", database } });
	});
	app.use("/api/v1/auth", authRouter);
	app.use("/api/v1/profiles", requireWorkspaceAuth, profileRouter);
	app.use("/api/v1", requireWorkspaceAuth, resolveProfileContext);
	app.use("/api/v1/people", personRouter);
	app.use("/api/v1/projects", projectRouter);
	// Governance owns every configuration-changing path, so it is mounted ahead of the flags router.
	app.use("/api/v1/projects/:projectKey/flags/:flagKey/environments/:environment", governanceRouter);
	app.use("/api/v1/projects/:projectKey/flags", flagRouter);
	app.use("/api/v1/projects/:projectKey/segments", segmentRouter);
	app.use("/api/v1/projects/:projectKey/evaluate", evaluateRouter);
	app.use("/api/v1/projects/:projectKey/audience", audienceRouter);
	app.use("/api/v1/projects/:projectKey/change-requests", projectChangeRequestRouter);
	app.use("/api/v1/change-requests", changeRequestRouter);
	app.use("/api/v1/projects/:projectKey/rollouts", projectRolloutRouter);
	app.use("/api/v1/rollouts", rolloutRouter);
	app.use("/api/v1/audit", auditRouter);
	app.use(notFoundHandler);
	app.use(errorHandler);
	return app;
}
