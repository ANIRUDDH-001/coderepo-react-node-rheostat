import mongoose from "mongoose";
import { ENVIRONMENT_KEYS } from "../projects/project.model.js";

export const VERSION_SOURCES = ["create", "direct", "changeRequest", "rollback", "rollout", "promotion"];

const flagVersionSchema = new mongoose.Schema(
	{
		flagId: { type: mongoose.Schema.Types.ObjectId, ref: "Flag", required: true },
		projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
		environment: { type: String, enum: ENVIRONMENT_KEYS, required: true },
		version: { type: Number, required: true, min: 1 },
		config: { type: mongoose.Schema.Types.Mixed, required: true },
		actorId: { type: mongoose.Schema.Types.ObjectId, ref: "Person", required: true },
		reason: { type: String, default: "", maxlength: 300 },
		source: { type: String, enum: VERSION_SOURCES, required: true },
		changeRequestId: { type: mongoose.Schema.Types.ObjectId, ref: "ChangeRequest", default: null },
		rolloutPlanId: { type: mongoose.Schema.Types.ObjectId, ref: "RolloutPlan", default: undefined },
		stepId: { type: String, default: undefined },
	},
	{ timestamps: true, versionKey: false, minimize: false },
);

flagVersionSchema.index({ flagId: 1, environment: 1, version: 1 }, { unique: true });
flagVersionSchema.index({ projectId: 1, environment: 1, createdAt: -1 });
flagVersionSchema.index({ rolloutPlanId: 1, stepId: 1 }, { unique: true, sparse: true });

export const FlagVersion = mongoose.model("FlagVersion", flagVersionSchema);
