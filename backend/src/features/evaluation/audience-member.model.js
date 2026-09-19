import mongoose from "mongoose";

export const PLANS = ["free", "pro", "enterprise"];
export const PLATFORMS = ["web", "ios", "android"];

const audienceMemberSchema = new mongoose.Schema(
	{
		projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
		key: { type: String, required: true, maxlength: 120 },
		name: { type: String, required: true, maxlength: 120 },
		attributes: {
			country: { type: String, required: true },
			plan: { type: String, enum: PLANS, required: true },
			platform: { type: String, enum: PLATFORMS, required: true },
			appVersion: { type: String, required: true },
			betaOptIn: { type: Boolean, default: false },
			signupDate: { type: String, required: true },
			company: { type: String, default: "" },
		},
	},
	{ timestamps: false, versionKey: false },
);

audienceMemberSchema.index({ projectId: 1, key: 1 }, { unique: true });
audienceMemberSchema.index({ projectId: 1, name: 1 });

export const AudienceMember = mongoose.model("AudienceMember", audienceMemberSchema);
