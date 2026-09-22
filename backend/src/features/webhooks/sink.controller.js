import { randomUUID } from "node:crypto";
import express, { Router } from "express";
import mongoose from "mongoose";
import { AppError } from "../../shared/errors/app-error.js";
import { createRateLimiter } from "../../shared/middleware/rate-limit.js";
import { projectRepository } from "../projects/project.repository.js";
import { verify } from "./signature.js";
import { receiptRepository, subscriptionRepository } from "./webhook.repository.js";

const INVALID = (reason) => new AppError(401, "SIGNATURE_INVALID", "The webhook signature could not be verified.", { reason });

// The built-in receiver. Mounted ahead of the JSON parser so it verifies the HMAC over the exact bytes sent.
export function createSinkRouter({ projects, subscriptions, receipts, now = () => Date.now() }) {
	const limiter = createRateLimiter({ name: "sink", windowMs: 60000, max: 120, keyFor: (request) => request.params.token });
	const router = Router();
	router.post("/:token", limiter, express.raw({ type: "*/*", limit: "16kb" }), async (request, response, next) => {
		try {
			const project = await projects.findBySinkToken(request.params.token);
			if (!project) throw new AppError(404, "SINK_NOT_FOUND", "Unknown receiver token.");
			const body = Buffer.isBuffer(request.body) ? request.body.toString("utf8") : "";
			const deliveryId = request.get("x-rheostat-delivery") || "";
			const subscriptionId = request.get("x-rheostat-subscription") || "";
			const found = mongoose.isValidObjectId(subscriptionId) ? await subscriptions.findById(subscriptionId) : null;
			// Binding invariant: the subscription must belong to the project that owns this sink token.
			const subscription = found && String(found.projectId) === String(project._id) ? found : null;
			const check = subscription ? verify(subscription.secret, body, request.get("x-rheostat-signature"), { nowSeconds: Math.floor(now() / 1000) }) : { valid: false, error: "unknown subscription" };
			const receivedAt = new Date(now());
			// Atomic dedupe: valid deliveries key on the delivery id; invalid attempts are always recorded individually.
			const receipt = await receipts.record({
				projectId: project._id,
				subscriptionId: subscription?._id || null,
				dedupeKey: check.valid && deliveryId ? deliveryId : `invalid:${randomUUID()}`,
				deliveryId: deliveryId || "(none)",
				event: request.get("x-rheostat-event") || "(none)",
				lastReceivedAt: receivedAt,
				headers: Object.fromEntries(Object.entries(request.headers).filter(([name]) => name.startsWith("x-rheostat-"))),
				body,
				signatureValid: check.valid,
				signatureError: check.error || "",
			});
			if (!check.valid) throw INVALID(check.error);
			response.setHeader("X-Rheostat-Received-Count", receipt.receivedCount);
			response.status(204).end();
		} catch (error) {
			next(error);
		}
	});
	return router;
}

export const sinkRouter = createSinkRouter({ projects: projectRepository, subscriptions: subscriptionRepository, receipts: receiptRepository });
