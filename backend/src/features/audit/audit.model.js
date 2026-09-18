import mongoose from "mongoose";

const auditEntrySchema = new mongoose.Schema(
	{
		projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", default: null },
		actorId: { type: mongoose.Schema.Types.ObjectId, ref: "Person", required: true },
		action: { type: String, required: true, maxlength: 80 },
		entityType: { type: String, required: true, maxlength: 40 },
		entityId: { type: String, required: true, maxlength: 80 },
		entityLabel: { type: String, default: "", maxlength: 200 },
		summary: { type: String, required: true, maxlength: 500 },
		metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
		idempotencyKey: { type: String, default: undefined },
		at: { type: Date, required: true, default: Date.now },
	},
	{ timestamps: false, versionKey: false },
);

auditEntrySchema.index({ projectId: 1, at: -1 });
auditEntrySchema.index({ entityType: 1, entityId: 1, at: -1 });
auditEntrySchema.index({ actorId: 1, at: -1 });
auditEntrySchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

export const AuditEntry = mongoose.model("AuditEntry", auditEntrySchema);
