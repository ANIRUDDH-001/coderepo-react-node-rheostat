import mongoose from "mongoose";
import { logger } from "../logging/logger.js";

export async function connectDatabase(uri) {
	try {
		await mongoose.connect(uri);
		logger.info("database.connected");
	} catch (error) {
		logger.error("database.connect.failed", { error });
		process.exit(1);
	}
}

export async function disconnectDatabase() {
	await mongoose.disconnect();
}
