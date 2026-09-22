import mongoose from "mongoose";

export const ENVIRONMENT_KEYS = ["development", "staging", "production"];

const environmentSchema = new mongoose.Schema(
	{
		key: { type: String, enum: ENVIRONMENT_KEYS, required: true },
		name: { type: String, required: true, trim: true, maxlength: 60 },
		color: { type: String, required: true, match: /^#[0-9A-Fa-f]{6}$/ },
		protected: { type: Boolean, default: false },
		requiredApprovals: { type: Number, min: 1, max: 3, default: 1 },
	},
	{ _id: false },
);

const projectSchema = new mongoose.Schema(
	{
		key: { type: String, required: true, trim: true, lowercase: true, maxlength: 40 },
		name: { type: String, required: true, trim: true, maxlength: 80 },
		description: { type: String, default: "", maxlength: 500 },
		sortOrder: { type: Number, default: 0 },
		environments: { type: [environmentSchema], required: true },
		createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Person" },
		// Token for the built-in webhook receiver (hardening spec §9.4); the sink URL is derived from it.
		webhookSink: { token: { type: String, required: true } },
	},
	{ timestamps: true, versionKey: false },
);

projectSchema.index({ key: 1 }, { unique: true });

export const Project = mongoose.model("Project", projectSchema);
