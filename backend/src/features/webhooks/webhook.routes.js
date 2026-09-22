import { Router } from "express";
import { createWebhookHandlers } from "./webhook.controller.js";
import { webhookService } from "./webhook.service.js";

export function createWebhookRouters(service, options) {
	const h = createWebhookHandlers(service, options);
	const projectWebhookRouter = Router({ mergeParams: true });
	projectWebhookRouter.get("/", h.list);
	projectWebhookRouter.post("/", h.create);
	projectWebhookRouter.get("/sink/receipts", h.receipts);
	projectWebhookRouter.delete("/sink/receipts", h.clearReceipts);
	const webhookRouter = Router();
	webhookRouter.get("/:id", h.get);
	webhookRouter.patch("/:id", h.update);
	webhookRouter.delete("/:id", h.remove);
	webhookRouter.get("/:id/deliveries", h.deliveries);
	webhookRouter.post("/:id/test", h.test);
	const deliveryRouter = Router();
	deliveryRouter.get("/:id", h.getDelivery);
	deliveryRouter.post("/:id/redeliver", h.redeliver);
	return { projectWebhookRouter, webhookRouter, deliveryRouter };
}

export const { projectWebhookRouter, webhookRouter, deliveryRouter } = createWebhookRouters(webhookService);
