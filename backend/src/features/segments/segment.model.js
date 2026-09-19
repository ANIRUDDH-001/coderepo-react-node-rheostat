import mongoose from "mongoose";
import { OPERATORS } from "../evaluation/evaluator.js";

const clauseSchema = new mongoose.Schema(
	{
		attribute: { type: String, required: true, maxlength: 60 },
		operator: { type: String, enum: OPERATORS, required: true },
		values: { type: [{ type: String, maxlength: 200 }], default: [] },
		negate: { type: Boolean, default: false },
	},
	{ _id: false },
);

const segmentRuleSchema = new mongoose.Schema(
	{
		id: { type: String, required: true, maxlength: 40 },
		description: { type: String, default: "", maxlength: 200 },
		clauses: { type: [clauseSchema], default: [] },
	},
	{ _id: false },
);

const segmentSchema = new mongoose.Schema(
	{
		projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
		key: { type: String, required: true, trim: true, maxlength: 40 },
		name: { type: String, required: true, trim: true, maxlength: 80 },
		description: { type: String, default: "", maxlength: 500 },
		rules: { type: [segmentRuleSchema], default: [] },
		includedKeys: { type: [{ type: String, maxlength: 120 }], default: [] },
		excludedKeys: { type: [{ type: String, maxlength: 120 }], default: [] },
		createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Person", required: true },
	},
	{ timestamps: true, versionKey: false },
);

// The database is the uniqueness authority: concurrent creates cannot both succeed.
segmentSchema.index({ projectId: 1, key: 1 }, { unique: true });

export const Segment = mongoose.model("Segment", segmentSchema);
