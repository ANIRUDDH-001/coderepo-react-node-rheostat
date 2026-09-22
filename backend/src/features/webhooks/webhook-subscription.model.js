import mongoose from "mongoose";
import { ENVIRONMENT_KEYS } from "../projects/project.model.js";
import { WEBHOOK_EVENTS } from "./events-catalogue.js";

export const DISABLED_REASONS = ["AUTO_FAILURES", "MANUAL"];

const subscriptionSchema = new mongoose.Schema(
	{
		projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
		name: { type: String, required: true, trim: true, maxlength: 80 },
		url: { type: String, required: true, maxlength: 500 },
		secret: { type: String, required: true },
		events: { type: [{ type: String, enum: WEBHOOK_EVENTS }], required: true, validate: (value) => value.length > 0 },
		environments: { type: [{ type: String, enum: ENVIRONMENT_KEYS }], default: [] },
		enabled: { type: Boolean, default: true },
		disabledReason: { type: String, enum: [...DISABLED_REASONS, null], default: null },
		consecutiveFailures: { type: Number, default: 0 },
		lastDeliveryAt: { type: Date, default: null },
		lastDeliveryStatus: { type: String, enum: ["delivered", "dead", null], default: null },
		createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Person", required: true },
	},
	{ timestamps: true, versionKey: false },
);
subscriptionSchema.index({ projectId: 1, createdAt: -1 });
export const WebhookSubscription = mongoose.model("WebhookSubscription", subscriptionSchema);
