import mongoose from "mongoose";
import { ENVIRONMENT_KEYS } from "../projects/project.model.js";
import { ACTIVE_STATUSES, PLAN_STATUSES, STALL_REASONS, STEP_STATUSES } from "./plan.js";

const stepSchema = new mongoose.Schema(
	{
		id: { type: String, required: true },
		percent: { type: Number, required: true, min: 1, max: 100 },
		startAt: { type: Date, required: true },
		status: { type: String, enum: STEP_STATUSES, required: true, default: "pending" },
		claimedAt: { type: Date, default: undefined },
		appliedAt: { type: Date, default: undefined },
		appliedVersion: { type: Number, default: undefined },
	},
	{ _id: false },
);

// Spec §4.8. The plan stores percentages and version pointers only; the live configuration lives on the flag.
const rolloutPlanSchema = new mongoose.Schema(
	{
		projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
		flagId: { type: mongoose.Schema.Types.ObjectId, ref: "Flag", required: true },
		flagKey: { type: String, required: true },
		environment: { type: String, enum: ENVIRONMENT_KEYS, required: true },
		targetVariationId: { type: String, required: true },
		baselineVariationId: { type: String, required: true },
		bucketBy: { type: String, default: "key", trim: true, maxlength: 60 },
		steps: { type: [stepSchema], required: true },
		status: { type: String, enum: PLAN_STATUSES, required: true, default: "scheduled" },
		startedFromVersion: { type: Number, required: true, min: 1 },
		expectedVersion: { type: Number, required: true, min: 1 },
		lastAppliedStepId: { type: String, default: null },
		pausedAt: { type: Date, default: null },
		stallReason: { type: String, enum: [...STALL_REASONS, null], default: null },
		stalledAt: { type: Date, default: null },
		resolvedAt: { type: Date, default: null },
		createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Person", required: true },
	},
	{ timestamps: true, versionKey: false },
);

// At most one active plan per flag × environment: the guarded insert relies on this partial index.
rolloutPlanSchema.index(
	{ flagId: 1, environment: 1 },
	{ unique: true, partialFilterExpression: { status: { $in: ACTIVE_STATUSES } }, name: "one_active_plan_per_flag_env" },
);
rolloutPlanSchema.index({ projectId: 1, status: 1, createdAt: -1 });
rolloutPlanSchema.index({ status: 1, "steps.status": 1, "steps.startAt": 1 });

export const RolloutPlan = mongoose.model("RolloutPlan", rolloutPlanSchema);
