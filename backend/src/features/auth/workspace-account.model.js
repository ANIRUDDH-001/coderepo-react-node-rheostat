import mongoose from "mongoose";

const workspaceAccountSchema = new mongoose.Schema(
	{
		name: { type: String, required: true, trim: true, maxlength: 120 },
		email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254, unique: true },
		passwordHash: { type: String, required: true, select: false },
		allowedProfileIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Person", required: true }],
		active: { type: Boolean, default: true },
	},
	{ timestamps: true, versionKey: false },
);

export const WorkspaceAccount = mongoose.model("WorkspaceAccount", workspaceAccountSchema);
