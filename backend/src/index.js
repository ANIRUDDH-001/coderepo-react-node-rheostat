import dotenv from "dotenv";
import { createApp } from "./app.js";
import { rolloutService } from "./features/rollouts/rollout.service.js";
import { connectDatabase, disconnectDatabase } from "./shared/config/database.js";
import { initConfig } from "./shared/config/index.js";
import { logger } from "./shared/logging/logger.js";

dotenv.config({ quiet: true });

const config = initConfig();
const HOST = "0.0.0.0";

await connectDatabase(config.mongodbUri);

const server = createApp().listen(config.port, HOST, () => {
	logger.info("server.started", { port: config.port, env: config.nodeEnv });
});

// Rollout steps apply on a 30-second tick (spec §5.5); reads also reconcile, so this only bounds the latency.
const ROLLOUT_TICK_MS = 30000;
const rolloutTicker = setInterval(() => {
	rolloutService.reconcileDue(new Date()).catch((error) => logger.error("rollout.tick.failed", { error }));
}, ROLLOUT_TICK_MS);

async function shutdown(signal) {
	logger.info("server.stopping", { signal });
	clearInterval(rolloutTicker);
	server.close(async () => {
		await disconnectDatabase();
		process.exit(0);
	});
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
