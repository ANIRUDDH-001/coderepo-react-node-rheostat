import { AuditEntry } from "./audit.model.js";

export const auditRepository = {
	insert: (entry) => AuditEntry.create(entry).then((document) => document.toObject()),
	findByIdempotencyKey: (idempotencyKey) => AuditEntry.findOne({ idempotencyKey }).lean(),
	findPage: (filter, limit) => AuditEntry.find(filter).sort({ at: -1, _id: -1 }).limit(limit).lean(),
	findForEntity: (entityType, entityId, actions) =>
		AuditEntry.find({ entityType, entityId: String(entityId), ...(actions ? { action: { $in: actions } } : {}) })
			.sort({ at: -1 })
			.lean(),
	insertMany: (entries) => AuditEntry.insertMany(entries),
	deleteAll: () => AuditEntry.deleteMany({}),
};
