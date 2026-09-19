import mongoose from "mongoose";
import { ENVIRONMENT_KEYS } from "../projects/project.model.js";
import { KINDS, STATUSES } from "./transitions.js";

const reviewSchema = new mongoose.Schema(
	{
		reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: "Person", required: true },
		decision: { type: String, enum: ["approve", "reject"], required: true },
		comment: { type: String, default: "", maxlength: 2000 },
		at: { type: Date, required: true },
	},
	{ _id: false },
);

const commentSchema = new mongoose.Schema(
	{
		id: { type: String, required: true },
		authorId: { type: mongoose.Schema.Types.ObjectId, ref: "Person", required: true },
		body: { type: String, required: true, maxlength: 2000 },
		at: { type: Date, required: true },
	},
	{ _id: false },
);

const changeRequestSchema = new mongoose.Schema(
	{
		projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
		flagId: { type: mongoose.Schema.Types.ObjectId, ref: "Flag", required: true },
		flagKey: { type: String, required: true },
		environment: { type: String, enum: ENVIRONMENT_KEYS, required: true },
		kind: { type: String, enum: KINDS, required: true },
		title: { type: String, required: true, trim: true, maxlength: 140 },
		description: { type: String, default: "", maxlength: 2000 },
		proposedConfig: { type: mongoose.Schema.Types.Mixed, required: true },
		baseVersion: { type: Number, required: true, min: 1 },
		sourceEnvironment: { type: String, enum: ENVIRONMENT_KEYS, default: undefined },
		sourceVersion: { type: Number, default: undefined },
		policy: { requiredApprovals: { type: Number, min: 1, max: 3, default: 1 } },
		status: { type: String, enum: STATUSES, required: true, default: "pending" },
		authorId: { type: mongoose.Schema.Types.ObjectId, ref: "Person", required: true },
		reviews: { type: [reviewSchema], default: [] },
		comments: { type: [commentSchema], default: [] },
		appliedVersion: { type: Number, default: null },
		appliedAt: { type: Date, default: null },
		appliedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Person", default: null },
		resolvedAt: { type: Date, default: null },
	},
	{ timestamps: true, versionKey: false, minimize: false },
);

changeRequestSchema.index({ projectId: 1, status: 1, createdAt: -1 });
changeRequestSchema.index({ flagId: 1, environment: 1, status: 1 });
changeRequestSchema.index({ authorId: 1, createdAt: -1 });

export const ChangeRequest = mongoose.model("ChangeRequest", changeRequestSchema);
