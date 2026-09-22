import mongoose from "mongoose";

export const DELIVERY_STATUSES = ["pending", "held", "delivering", "delivered", "dead"];

const attemptSchema = new mongoose.Schema(
	{
		at: { type: Date, required: true },
		outcome: { type: String, enum: ["delivered", "failed"], required: true },
		durationMs: { type: Number, required: true },
		responseStatus: { type: Number, default: undefined },
		responseSnippet: { type: String, default: undefined, maxlength: 500 },
		error: { type: String, default: undefined, maxlength: 300 },
	},
	{ _id: false },
);

const deliverySchema = new mongoose.Schema(
	{
		subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: "WebhookSubscription", required: true },
		projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
		eventId: { type: String, required: true },
		event: { type: String, required: true },
		payload: { type: mongoose.Schema.Types.Mixed, required: true },
		status: { type: String, enum: DELIVERY_STATUSES, required: true, default: "pending" },
		attempts: { type: [attemptSchema], default: [] },
		budgetFrom: { type: Number, default: 0 },
		nextAttemptAt: { type: Date, required: true },
		claimedAt: { type: Date, default: null },
		deliveredAt: { type: Date, default: null },
	},
	{ timestamps: true, versionKey: false, minimize: false },
);
deliverySchema.index({ subscriptionId: 1, eventId: 1 }, { unique: true });
deliverySchema.index({ status: 1, nextAttemptAt: 1 });
deliverySchema.index({ subscriptionId: 1, createdAt: -1, _id: -1 });
deliverySchema.index({ projectId: 1, status: 1 });
export const WebhookDelivery = mongoose.model("WebhookDelivery", deliverySchema);
