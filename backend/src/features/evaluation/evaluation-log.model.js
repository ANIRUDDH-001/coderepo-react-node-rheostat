import mongoose from "mongoose";
import { ENVIRONMENT_KEYS } from "../projects/project.model.js";
import { REASONS } from "./evaluator.js";

export const LOG_SOURCES = ["playground", "simulated"];

const evaluationLogSchema = new mongoose.Schema(
	{
		projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
		flagId: { type: mongoose.Schema.Types.ObjectId, ref: "Flag", required: true },
		flagKey: { type: String, required: true, maxlength: 40 },
		environment: { type: String, enum: ENVIRONMENT_KEYS, required: true },
		contextKey: { type: String, required: true, maxlength: 120 },
		variationId: { type: String, default: null },
		reasonKind: { type: String, enum: Object.values(REASONS), required: true },
		source: { type: String, enum: LOG_SOURCES, required: true },
		at: { type: Date, required: true, default: Date.now },
	},
	{ timestamps: false, versionKey: false },
);

evaluationLogSchema.index({ projectId: 1, at: -1 });
evaluationLogSchema.index({ flagId: 1, environment: 1, at: -1 });

export const EvaluationLog = mongoose.model("EvaluationLog", evaluationLogSchema);
