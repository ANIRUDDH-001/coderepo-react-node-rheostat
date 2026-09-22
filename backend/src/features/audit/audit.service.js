import { AppError } from "../../shared/errors/app-error.js";
import { auditRepository } from "./audit.repository.js";

const toEntry = ({
	actor,
	actorKind,
	action,
	entityType,
	entityId,
	entityLabel = "",
	projectId = null,
	summary,
	metadata = {},
	idempotencyKey,
	at,
}) => ({
	actorId: actor._id,
	actorKind: actorKind || (actor.system ? "system" : "user"),
	action,
	entityType,
	entityId: String(entityId),
	entityLabel,
	projectId,
	summary,
	metadata,
	...(idempotencyKey ? { idempotencyKey } : {}),
	...(at ? { at } : {}),
});

export const auditService = {
	// Awaited by every caller: a mutation without its history entry is a failure, not a warning.
	async record(input) {
		try {
			return await auditRepository.insert(toEntry(input));
		} catch (error) {
			throw new AppError(500, "AUDIT_WRITE_FAILED", "The change was saved but its history entry could not be written.", {
				action: input.action,
				cause: error.message,
			});
		}
	},
	// Idempotent variant for automated rollout steps and their crash recovery.
	async recordOnce(input) {
		if (!input.idempotencyKey) throw new Error("recordOnce requires an idempotencyKey.");
		try {
			return await auditRepository.insert(toEntry(input));
		} catch (error) {
			if (error?.code === 11000) return auditRepository.findByIdempotencyKey(input.idempotencyKey);
			throw new AppError(500, "AUDIT_WRITE_FAILED", "The change was saved but its history entry could not be written.", {
				action: input.action,
				cause: error.message,
			});
		}
	},
	async list({ projectId = null, entityType, actorId, before, limit = 25 }) {
		const filter = {};
		if (projectId) filter.projectId = projectId;
		if (entityType) filter.entityType = entityType;
		if (actorId) filter.actorId = actorId;
		if (before) filter.at = { $lt: before };
		const entries = await auditRepository.findPage(filter, limit + 1);
		const page = entries.slice(0, limit);
		return { items: page, nextBefore: entries.length > limit ? page.at(-1).at : null };
	},
	listForEntity: (entityType, entityId, actions) => auditRepository.findForEntity(entityType, entityId, actions),
};
