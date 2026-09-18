import cors from "cors";
import express from "express";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";
import { authRouter } from "./features/auth/auth.routes.js";
import { personRouter, profileRouter } from "./features/people/person.routes.js";
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
		response.status(database === "connected" ? 200 : 503).json({ data: { status: database === "connected" ? "ok" : "degraded", database } });
	});
	app.use("/api/v1/auth", authRouter);
	app.use("/api/v1/profiles", requireWorkspaceAuth, profileRouter);
	app.use("/api/v1", requireWorkspaceAuth, resolveProfileContext);
	app.use("/api/v1/people", personRouter);
	app.use(notFoundHandler);
	app.use(errorHandler);
	return app;
}
