import mongoose from "mongoose";

const receiptSchema = new mongoose.Schema(
	{
		projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
		subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: "WebhookSubscription", default: null },
		dedupeKey: { type: String, required: true },
		deliveryId: { type: String, required: true },
		event: { type: String, required: true },
		firstReceivedAt: { type: Date, required: true },
		lastReceivedAt: { type: Date, required: true },
		receivedCount: { type: Number, required: true, default: 1 },
		headers: { type: mongoose.Schema.Types.Mixed, default: {} },
		body: { type: String, required: true, maxlength: 16384 },
		signatureValid: { type: Boolean, required: true },
		signatureError: { type: String, default: "" },
	},
	{ timestamps: false, versionKey: false, minimize: false },
);
receiptSchema.index({ projectId: 1, dedupeKey: 1 }, { unique: true });
receiptSchema.index({ projectId: 1, lastReceivedAt: -1 });
export const WebhookReceipt = mongoose.model("WebhookReceipt", receiptSchema);
