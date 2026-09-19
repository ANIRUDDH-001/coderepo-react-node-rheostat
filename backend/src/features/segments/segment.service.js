import { AppError } from "../../shared/errors/app-error.js";
import { assertCan } from "../../shared/auth/permissions.js";
import { shortId } from "../../shared/utils/keys.js";
import { auditService } from "../audit/audit.service.js";
import { flagService } from "../flags/flag.service.js";
import { segmentRepository } from "./segment.repository.js";

export const SEGMENT_NOT_FOUND = () => new AppError(404, "SEGMENT_NOT_FOUND", "The requested segment does not exist.");

// Pure guards, tested without a database.
export function assertFlatRules(rules = []) {
	const nested = rules.some((rule) => (rule.clauses || []).some((clause) => clause.operator === "segmentMatch"));
	if (nested) {
		throw new AppError(422, "INVALID_CONFIG", "Segments cannot reference segments.", {
			issues: ["Segments cannot reference segments."],
		});
	}
}

export function assertRemovable(referencingFlagCount, key) {
	if (referencingFlagCount > 0) {
		throw new AppError(
			409,
			"SEGMENT_IN_USE",
			`Segment ${key} is referenced by ${referencingFlagCount} flag configuration(s). Remove those rules first.`,
			{
				referencingFlags: referencingFlagCount,
			},
		);
	}
}

export const withRuleIds = (rules = []) => rules.map((rule) => ({ ...rule, id: rule.id || shortId("sr") }));

const audit = (actor, action, project, segment, summary, metadata = {}) =>
	auditService.record({
		actor,
		action,
		entityType: "segment",
		entityId: segment._id,
		entityLabel: segment.key,
		projectId: project._id,
		summary,
		metadata,
	});

// Which flags reference a segment, per environment, so the UI can explain "used by N flags" before a delete.
export function referencesFor(segmentKey, flags) {
	const references = [];
	for (const flag of flags) {
		const environments = Object.entries(flag.environments || {})
			.filter(([, config]) => (config.rules || []).some((rule) => (rule.clauses || []).some((clause) => clause.operator === "segmentMatch" && (clause.values || []).includes(segmentKey))))
			.map(([environment]) => environment);
		if (environments.length) references.push({ key: flag.key, name: flag.name, archived: flag.archived, environments });
	}
	return references;
}

export const segmentService = {
	async listByProject(project) {
		const [segments, flags] = await Promise.all([segmentRepository.findByProject(project._id), flagService.findAllByProject(project._id)]);
		return segments.map((segment) => ({ ...segment, referencedBy: referencesFor(segment.key, flags) }));
	},
	async mapByKey(projectId) {
		const segments = await segmentRepository.findByProject(projectId);
		return Object.fromEntries(segments.map((segment) => [segment.key, segment]));
	},
	async getByKey(project, key) {
		const segment = await segmentRepository.findByKey(project._id, key);
		if (!segment) throw SEGMENT_NOT_FOUND();
		return segment;
	},
	async getDetail(project, key) {
		const [segment, flags] = await Promise.all([this.getByKey(project, key), flagService.findAllByProject(project._id)]);
		return { ...segment, referencedBy: referencesFor(key, flags) };
	},
	async create(project, input, actor) {
		assertCan(actor, "segment:manage");
		assertFlatRules(input.rules);
		const segment = await segmentRepository.create({
			...input,
			rules: withRuleIds(input.rules),
			projectId: project._id,
			createdBy: actor._id,
		});
		await audit(actor, "segment.created", project, segment, `${actor.name} created segment ${segment.key}.`, { key: segment.key });
		return segment;
	},
	async update(project, key, input, actor) {
		assertCan(actor, "segment:manage");
		const segment = await this.getByKey(project, key);
		const patch = { ...input };
		if (input.rules) {
			assertFlatRules(input.rules);
			patch.rules = withRuleIds(input.rules);
		}
		const updated = await segmentRepository.update(segment._id, patch);
		await audit(
			actor,
			"segment.updated",
			project,
			updated,
			`${actor.name} updated ${Object.keys(patch).join(", ")} on segment ${key}.`,
			{
				fields: Object.keys(patch),
			},
		);
		return updated;
	},
	async remove(project, key, actor) {
		assertCan(actor, "segment:manage");
		const segment = await this.getByKey(project, key);
		assertRemovable(await flagService.countReferencingSegment(project._id, key), key);
		await segmentRepository.remove(segment._id);
		await audit(actor, "segment.deleted", project, segment, `${actor.name} deleted segment ${key}.`, { key });
	},
};
