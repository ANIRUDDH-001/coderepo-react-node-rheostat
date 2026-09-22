import dotenv from "dotenv";
import { createApp } from "./app.js";
import { rolloutService } from "./features/rollouts/rollout.service.js";
import { webhookService } from "./features/webhooks/webhook.service.js";
import { connectDatabase, disconnectDatabase } from "./shared/config/database.js";
import { initConfig } from "./shared/config/index.js";
import { logger } from "./shared/logging/logger.js";

dotenv.config({ quiet: true });

const config = initConfig();
const HOST = "0.0.0.0";
const ROLLOUT_TICK_MS = 30000;
const WEBHOOK_TICK_MS = 5000;

await connectDatabase(config.mongodbUri);

const server = createApp().listen(config.port, HOST, () => {
	logger.info("server.started", {
		port: config.port,
		env: config.nodeEnv,
		tickers: [`rollouts:${ROLLOUT_TICK_MS}`, `webhooks:${WEBHOOK_TICK_MS}`],
	});
});

// Rollout steps apply on a 30-second tick (spec §5.5); reads also reconcile, so this only bounds the latency.
const rolloutTicker = setInterval(() => {
	rolloutService.reconcileDue(new Date()).catch((error) => logger.error("rollout.tick.failed", { error }));
}, ROLLOUT_TICK_MS);

// Webhook deliveries are kicked on enqueue; the 5-second tick catches retries and stale claims (hardening spec §9.3).
const webhookTicker = setInterval(() => {
	webhookService.dispatchDue(new Date()).catch((error) => logger.error("webhook.tick.failed", { error }));
}, WEBHOOK_TICK_MS);

async function shutdown(signal) {
	logger.info("server.stopping", { signal });
	clearInterval(rolloutTicker);
	clearInterval(webhookTicker);
	server.close(async () => {
		await disconnectDatabase();
		process.exit(0);
	});
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
