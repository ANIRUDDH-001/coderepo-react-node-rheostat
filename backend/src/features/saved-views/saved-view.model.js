import mongoose from "mongoose";
import { ENVIRONMENT_KEYS } from "../projects/project.model.js";

// Personal filter presets for the flags list (spec §4.12). Filters mirror the flags list query.
const filtersSchema = new mongoose.Schema(
	{
		query: { type: String, maxlength: 100 },
		environment: { type: String, enum: ENVIRONMENT_KEYS },
		state: { type: String, enum: ["on", "off"] },
		tags: { type: [String], default: undefined },
		type: { type: String, enum: ["boolean", "string", "number", "json"] },
		lifecycle: { type: String, enum: ["temporary", "permanent"] },
		stale: { type: String, enum: ["readyToRemove", "overdue"] },
		ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "Person" },
		archived: { type: Boolean },
	},
	{ _id: false, minimize: false },
);

const savedViewSchema = new mongoose.Schema(
	{
		ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "Person", required: true },
		projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
		name: { type: String, required: true, trim: true, maxlength: 60 },
		filters: { type: filtersSchema, default: () => ({}) },
		sort: { type: String, enum: ["updated", "name", "key", "stale"], default: "updated" },
	},
	{ timestamps: true, versionKey: false, minimize: false },
);

savedViewSchema.index({ ownerId: 1, projectId: 1, name: 1 }, { unique: true });

export const SavedView = mongoose.model("SavedView", savedViewSchema);
