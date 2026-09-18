import mongoose from "mongoose";
import { OPERATORS } from "../evaluation/evaluator.js";
import { ENVIRONMENT_KEYS } from "../projects/project.model.js";
import { FLAG_TYPES } from "./env-config.js";

const clauseSchema = new mongoose.Schema(
	{
		attribute: { type: String, required: true, maxlength: 60 },
		operator: { type: String, enum: OPERATORS, required: true },
		values: { type: [{ type: String, maxlength: 200 }], default: [] },
		negate: { type: Boolean, default: false },
	},
	{ _id: false },
);

const weightSchema = new mongoose.Schema({ variationId: { type: String, required: true }, weight: { type: Number, min: 0, max: 100000, required: true } }, { _id: false });

const serveSchema = new mongoose.Schema(
	{
		variationId: { type: String, default: undefined },
		rollout: { type: new mongoose.Schema({ bucketBy: { type: String, default: "key" }, weights: { type: [weightSchema], default: undefined } }, { _id: false }), default: undefined },
	},
	{ _id: false },
);

const ruleSchema = new mongoose.Schema(
	{
		id: { type: String, required: true, maxlength: 40 },
		description: { type: String, default: "", maxlength: 200 },
		clauses: { type: [clauseSchema], default: [] },
		serve: { type: serveSchema, required: true },
	},
	{ _id: false },
);

export const envConfigSchema = new mongoose.Schema(
	{
		version: { type: Number, required: true, min: 1, default: 1 },
		enabled: { type: Boolean, default: false },
		offVariationId: { type: String, required: true },
		rules: { type: [ruleSchema], default: [] },
		fallthrough: { type: serveSchema, required: true },
		lastEffectiveChangeAt: { type: Date, default: Date.now },
		lastChangedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Person", default: null },
	},
	{ _id: false },
);

const variationSchema = new mongoose.Schema(
	{
		id: { type: String, required: true, maxlength: 40 },
		name: { type: String, required: true, trim: true, maxlength: 60 },
		value: { type: mongoose.Schema.Types.Mixed, required: true },
	},
	{ _id: false },
);

const flagSchema = new mongoose.Schema(
	{
		projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, index: true },
		key: { type: String, required: true, trim: true, maxlength: 40 },
		name: { type: String, required: true, trim: true, maxlength: 120 },
		description: { type: String, default: "", maxlength: 1000 },
		type: { type: String, enum: FLAG_TYPES, required: true },
		variations: { type: [variationSchema], required: true },
		tags: { type: [{ type: String, trim: true, lowercase: true, maxlength: 30 }], default: [] },
		ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "Person", default: null },
		lifecycle: {
			kind: { type: String, enum: ["temporary", "permanent"], default: "temporary" },
			removeBy: { type: Date, default: null },
		},
		archived: { type: Boolean, default: false, index: true },
		archivedAt: { type: Date, default: null },
		archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Person", default: null },
		killSwitch: {
			active: { type: Boolean, default: false },
			reason: { type: String, default: "", maxlength: 300 },
			actorId: { type: mongoose.Schema.Types.ObjectId, ref: "Person", default: null },
			activatedAt: { type: Date, default: null },
		},
		environments: Object.fromEntries(ENVIRONMENT_KEYS.map((key) => [key, { type: envConfigSchema, required: true }])),
		createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Person", required: true },
	},
	{ timestamps: true, versionKey: false, minimize: false },
);

flagSchema.index({ projectId: 1, key: 1 }, { unique: true });
flagSchema.index({ projectId: 1, archived: 1, tags: 1 });
flagSchema.index({ projectId: 1, archived: 1, updatedAt: -1 });

export const Flag = mongoose.model("Flag", flagSchema);
