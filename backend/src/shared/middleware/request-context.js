import { randomUUID } from "node:crypto";
import { logger } from "../logging/logger.js";

const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/;

// First middleware after CORS, ahead of every body parser, so a request that fails to parse still has an id.
export function createRequestContext({ log = logger, now = () => performance.now() } = {}) {
	return function requestContext(request, response, next) {
		const supplied = request.get("x-request-id") || "";
		request.id = CLIENT_ID.test(supplied) ? supplied : randomUUID();
		response.setHeader("X-Request-Id", request.id);
		const started = now();
		response.on("finish", () => {
			log.info("http.request", {
				requestId: request.id,
				method: request.method,
				path: request.originalUrl.split("?")[0],
				status: response.statusCode,
				durationMs: Math.round(now() - started),
				...(request.account ? { accountId: String(request.account._id) } : {}),
				...(request.profileId ? { profileId: request.profileId } : {}),
			});
		});
		next();
	};
}

export const requestContext = createRequestContext();
