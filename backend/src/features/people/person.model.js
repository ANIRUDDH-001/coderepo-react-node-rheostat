import mongoose from "mongoose";
import { ROLES } from "../../shared/auth/permissions.js";

const personSchema = new mongoose.Schema(
	{
		name: { type: String, required: true, trim: true, maxlength: 120 },
		email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
		avatarColor: { type: String, required: true, match: /^#[0-9A-Fa-f]{6}$/ },
		role: { type: String, enum: ROLES, required: true, index: true },
		headline: { type: String, default: "", trim: true, maxlength: 120 },
		isProfile: { type: Boolean, default: true, index: true },
		sortOrder: { type: Number, default: 0 },
	},
	{ timestamps: true, versionKey: false },
);

personSchema.index({ email: 1 }, { unique: true });
personSchema.index({ name: 1 });

export const Person = mongoose.model("Person", personSchema);
