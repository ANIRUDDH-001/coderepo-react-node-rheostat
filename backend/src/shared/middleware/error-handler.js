import { ZodError } from "zod";
import { AppError } from "../errors/app-error.js";
import { logger } from "../logging/logger.js";

const envelope = (request, code, message, details) => ({
	error: { code, message, ...(details !== undefined ? { details } : {}), requestId: request.id || null },
});

export function notFoundHandler(request, response) {
	response.status(404).json(envelope(request, "NOT_FOUND", `Route ${request.method} ${request.path} was not found.`));
}

export function errorHandler(error, request, response, next) {
	if (error instanceof ZodError) {
		return response.status(400).json(envelope(request, "VALIDATION_ERROR", "Request validation failed.", error.flatten()));
	}
	if (error instanceof AppError) {
		if (error.statusCode >= 500) logger.error("http.error", { requestId: request.id, code: error.code, error });
		return response.status(error.statusCode).json(envelope(request, error.code, error.message, error.details));
	}
	if (error?.type === "entity.parse.failed") {
		return response.status(400).json(envelope(request, "INVALID_JSON", "The request body is not valid JSON."));
	}
	if (error?.type === "entity.too.large") {
		return response.status(413).json(envelope(request, "PAYLOAD_TOO_LARGE", "The request body is too large."));
	}
	if (error?.code === 11000) {
		const field = Object.keys(error.keyPattern || {}).join(", ") || "value";
		return response.status(409).json(envelope(request, "DUPLICATE_KEY", `A record with the same ${field} already exists.`));
	}
	logger.error("http.error", { requestId: request.id, error });
	return response.status(500).json(envelope(request, "INTERNAL_ERROR", "An unexpected error occurred."));
}
