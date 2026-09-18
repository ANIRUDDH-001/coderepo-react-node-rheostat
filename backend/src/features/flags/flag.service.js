import { AppError } from "../../shared/errors/app-error.js";
import { assertCan } from "../../shared/auth/permissions.js";
import { escapeRegex, shortId } from "../../shared/utils/keys.js";
import { pageResult } from "../../shared/utils/pagination.js";
import { auditService } from "../audit/audit.service.js";
import { ENVIRONMENT_KEYS } from "../projects/project.model.js";
import { diffEnvConfig, normalizeConfig } from "./config-diff.js";
import { initialConfig, variationValueSchema } from "./env-config.js";
import { flagRepository } from "./flag.repository.js";
import { flagVersionRepository } from "./flag-version.repository.js";
import { staleState } from "./lifecycle.js";

export const FLAG_NOT_FOUND = () => new AppError(404, "FLAG_NOT_FOUND", "The requested flag does not exist.");
const VERSION_CONFLICT = () => new AppError(409, "VERSION_CONFLICT", "This environment changed since you loaded it. Reload and try again.");
const INVALID = (message, issues = [message]) => new AppError(422, "INVALID_CONFIG", message, { issues });

const summarizeServe = (serve, variations) => {
	const nameOf = (id) => variations.find((variation) => variation.id === id)?.name || id;
	if (serve?.variationId) return { kind: "fixed", variationId: serve.variationId, label: nameOf(serve.variationId) };
	const weights = serve?.rollout?.weights || [];
	const leading = [...weights].sort((left, right) => right.weight - left.weight)[0];
	return {
		kind: "rollout",
		label: weights
			.filter((entry) => entry.weight > 0)
			.map((entry) => `${nameOf(entry.variationId)} ${(entry.weight / 1000).toFixed(entry.weight % 1000 ? 1 : 0)}%`)
			.join(" · "),
		leadingVariationId: leading?.variationId,
		weights,
	};
};

export const decorateFlag = (flag, now = new Date()) => ({
	...flag,
	stale: staleState(flag, now),
	environmentSummaries: Object.fromEntries(
		ENVIRONMENT_KEYS.map((key) => {
			const config = flag.environments[key];
			return [key, { enabled: config.enabled, version: config.version, ruleCount: config.rules.length, fallthrough: summarizeServe(config.fallthrough, flag.variations), lastEffectiveChangeAt: config.lastEffectiveChangeAt }];
		}),
	),
});

const buildVariations = (type, variations) => {
	if (type === "boolean") {
		return [
			{ id: "v_true", name: "True", value: true },
			{ id: "v_false", name: "False", value: false },
		];
	}
	return variations.map((variation) => ({ id: shortId("v"), name: variation.name, value: variation.value }));
};

const validateVariationValues = (type, variations) => {
	const schema = variationValueSchema(type);
	const issues = variations.filter((variation) => !schema.safeParse(variation.value).success).map((variation) => `Variation ${variation.name} has a value that is not a valid ${type}.`);
	if (issues.length) throw INVALID("Variation values do not match the flag type.", issues);
};

function listFilter(projectId, filters) {
	const filter = { projectId, archived: Boolean(filters.archived) };
	if (filters.query) {
		const expression = { $regex: escapeRegex(filters.query), $options: "i" };
		filter.$or = [{ key: expression }, { name: expression }, { description: expression }];
	}
	if (filters.tags?.length) filter.tags = { $all: filters.tags };
	if (filters.type) filter.type = filters.type;
	if (filters.ownerId) filter.ownerId = filters.ownerId;
	if (filters.lifecycle) filter["lifecycle.kind"] = filters.lifecycle;
	if (filters.state && filters.state !== "any" && filters.environment) filter[`environments.${filters.environment}.enabled`] = filters.state === "on";
	return filter;
}

const SORTS = { updated: { updatedAt: -1 }, name: { name: 1 }, key: { key: 1 }, stale: { updatedAt: -1 } };
const staleRank = (flag) => (flag.stale.overdue ? 0 : flag.stale.readyToRemove ? 1 : 2);

export const flagService = {
	async list(project, filters) {
		const filter = listFilter(project._id, filters);
		const wantsStale = filters.stale && filters.stale !== "any";
		const sortByStale = filters.sort === "stale";
		if (wantsStale || sortByStale) {
			// Staleness is computed, so filter and sort in memory over the project's flags (bounded: a project holds tens of flags).
			const all = (await flagRepository.findPage(filter, SORTS[filters.sort] || SORTS.updated, 0, 1000)).map((flag) => decorateFlag(flag));
			const matching = all.filter((flag) => !wantsStale || (filters.stale === "readyToRemove" ? flag.stale.readyToRemove : flag.stale.overdue));
			if (sortByStale) matching.sort((left, right) => staleRank(left) - staleRank(right) || right.updatedAt - left.updatedAt);
			const start = (filters.page - 1) * filters.pageSize;
			return pageResult(matching.slice(start, start + filters.pageSize), matching.length, filters.page, filters.pageSize);
		}
		const [items, total] = await Promise.all([
			flagRepository.findPage(filter, SORTS[filters.sort] || SORTS.updated, (filters.page - 1) * filters.pageSize, filters.pageSize),
			flagRepository.count(filter),
		]);
		return pageResult(items.map((flag) => decorateFlag(flag)), total, filters.page, filters.pageSize);
	},
	async getByKey(project, key) {
		const flag = await flagRepository.findByKey(project._id, key);
		if (!flag) throw FLAG_NOT_FOUND();
		return decorateFlag(flag);
	},
	async getRawByKey(project, key) {
		const flag = await flagRepository.findByKey(project._id, key);
		if (!flag) throw FLAG_NOT_FOUND();
		return flag;
	},
	findActiveByProject: (projectId) => flagRepository.findActiveByProject(projectId),
	countReferencingSegment: (projectId, segmentKey) => flagRepository.countReferencingSegment(projectId, segmentKey),
	async create(project, input, actor) {
		assertCan(actor, "flag:create");
		const variations = buildVariations(input.type, input.variations || []);
		validateVariationValues(input.type, variations);
		const draft = { ...input, variations };
		const config = initialConfig(draft);
		const flag = await flagRepository.create({
			projectId: project._id,
			key: input.key,
			name: input.name,
			description: input.description,
			type: input.type,
			variations,
			tags: input.tags,
			ownerId: input.ownerId || actor._id,
			lifecycle: input.lifecycle,
			killSwitch: { active: false, reason: "", actorId: null, activatedAt: null },
			environments: Object.fromEntries(ENVIRONMENT_KEYS.map((key) => [key, { ...config, lastEffectiveChangeAt: new Date(), lastChangedBy: actor._id }])),
			createdBy: actor._id,
		});
		await flagVersionRepository.insertMany(
			ENVIRONMENT_KEYS.map((environment) => ({
				flagId: flag._id,
				projectId: project._id,
				environment,
				version: 1,
				config: normalizeConfig(flag.environments[environment]),
				actorId: actor._id,
				reason: "Flag created",
				source: "create",
			})),
		);
		await auditService.record({
			actor,
			action: "flag.created",
			entityType: "flag",
			entityId: flag._id,
			entityLabel: flag.key,
			projectId: project._id,
			summary: `${actor.name} created flag ${flag.key} (${flag.type}).`,
			metadata: { key: flag.key, type: flag.type },
		});
		return decorateFlag(flag);
	},
	async updateMetadata(project, key, input, actor) {
		assertCan(actor, "flag:editMetadata");
		const flag = await this.getRawByKey(project, key);
		const patch = {};
		for (const field of ["name", "description", "tags", "ownerId", "lifecycle"]) if (input[field] !== undefined) patch[field] = input[field];
		if (input.variations) {
			if (flag.type === "boolean") throw INVALID("Boolean flags always have exactly two variations.");
			const existingIds = new Set(flag.variations.map((variation) => variation.id));
			const incomingIds = input.variations.filter((variation) => variation.id).map((variation) => variation.id);
			const removed = [...existingIds].filter((id) => !incomingIds.includes(id));
			if (removed.length) throw INVALID("Variations cannot be removed once created.", removed.map((id) => `Variation ${id} cannot be removed.`));
			const merged = input.variations.map((variation) => {
				const existing = flag.variations.find((candidate) => candidate.id === variation.id);
				if (existing) {
					if (variation.value !== undefined && JSON.stringify(variation.value) !== JSON.stringify(existing.value)) {
						throw INVALID("Variation values are immutable.", [`Variation ${existing.name} cannot change its value.`]);
					}
					return { ...existing, name: variation.name ?? existing.name };
				}
				return { id: shortId("v"), name: variation.name, value: variation.value };
			});
			if (merged.length > 8) throw INVALID("A flag may have at most 8 variations.");
			validateVariationValues(flag.type, merged);
			patch.variations = merged;
		}
		const updated = await flagRepository.updateMetadata(flag._id, patch);
		await auditService.record({
			actor,
			action: "flag.metadataUpdated",
			entityType: "flag",
			entityId: flag._id,
			entityLabel: flag.key,
			projectId: project._id,
			summary: `${actor.name} updated ${Object.keys(patch).join(", ")} on flag ${flag.key}.`,
			metadata: { fields: Object.keys(patch) },
		});
		return decorateFlag(updated);
	},
	async setArchived(project, key, archived, actor) {
		assertCan(actor, archived ? "flag:archive" : "flag:restore");
		const flag = await this.getRawByKey(project, key);
		if (flag.archived === archived) throw new AppError(422, "INVALID_TRANSITION", archived ? "This flag is already archived." : "This flag is not archived.");
		const updated = await flagRepository.setArchived(flag._id, archived, actor._id);
		await auditService.record({
			actor,
			action: archived ? "flag.archived" : "flag.restored",
			entityType: "flag",
			entityId: flag._id,
			entityLabel: flag.key,
			projectId: project._id,
			summary: `${actor.name} ${archived ? "archived" : "restored"} flag ${flag.key}.`,
		});
		return decorateFlag(updated);
	},
	// Mutate → snapshot → audit. `audit` is required: a descriptor records one entry, `false` means the caller owns the entry.
	async writeVersion(flag, environment, config, { actorId, source, reason = "", audit, changeRequestId = null, expectedVersion }) {
		if (audit === undefined) throw new Error("writeVersion requires an explicit audit descriptor or false.");
		const decision = normalizeConfig(config);
		const updated = await flagRepository.mutateEnvironment(flag._id, environment, expectedVersion, decision, actorId);
		if (!updated) throw VERSION_CONFLICT();
		const version = await flagVersionRepository.insert({
			flagId: flag._id,
			projectId: flag.projectId,
			environment,
			version: updated.environments[environment].version,
			config: decision,
			actorId,
			reason,
			source,
			changeRequestId,
		});
		if (audit) {
			await auditService.record({
				actor: audit.actor,
				action: audit.action,
				entityType: "flag",
				entityId: flag._id,
				entityLabel: flag.key,
				projectId: flag.projectId,
				summary: audit.summary,
				metadata: { environment, version: version.version, reason, ...(audit.metadata || {}) },
			});
		}
		return { flag: decorateFlag(updated), version };
	},
	async getVersion(flag, environment, version) {
		const snapshot = await flagVersionRepository.findOne(flag._id, environment, version);
		if (!snapshot) throw new AppError(404, "VERSION_NOT_FOUND", `Version ${version} does not exist for ${environment}.`);
		return snapshot;
	},
	async listVersions(project, key, environment) {
		const flag = await this.getRawByKey(project, key);
		const versions = await flagVersionRepository.findByFlagAndEnvironment(flag._id, environment);
		const withDiffs = versions.map((entry, index) => ({
			...entry,
			diff: index + 1 < versions.length ? diffEnvConfig(versions[index + 1].config, entry.config) : [],
			kind: "version",
		}));
		const killSwitchEvents = (await auditService.listForEntity("flag", flag._id, ["flag.killSwitch.activated", "flag.killSwitch.cleared"])).map((entry) => ({
			kind: "killSwitch",
			_id: entry._id,
			action: entry.action,
			actorId: entry.actorId,
			summary: entry.summary,
			reason: entry.metadata?.reason || "",
			createdAt: entry.at,
		}));
		return [...withDiffs, ...killSwitchEvents].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
	},
	async activateKillSwitch(project, key, reason, actor) {
		assertCan(actor, "flag:killSwitch");
		const flag = await this.getRawByKey(project, key);
		if (flag.killSwitch.active) throw new AppError(422, "INVALID_TRANSITION", "The kill switch is already active for this flag.");
		const updated = await flagRepository.setKillSwitch(flag._id, { active: true, reason, actorId: actor._id, activatedAt: new Date() });
		await auditService.record({
			actor,
			action: "flag.killSwitch.activated",
			entityType: "flag",
			entityId: flag._id,
			entityLabel: flag.key,
			projectId: project._id,
			summary: `${actor.name} activated the kill switch on ${flag.key}: ${reason}`,
			metadata: { reason },
		});
		return decorateFlag(updated);
	},
	async clearKillSwitch(project, key, actor) {
		assertCan(actor, "flag:killSwitch");
		const flag = await this.getRawByKey(project, key);
		if (!flag.killSwitch.active) throw new AppError(422, "INVALID_TRANSITION", "The kill switch is not active for this flag.");
		const updated = await flagRepository.setKillSwitch(flag._id, { active: false, reason: "", actorId: null, activatedAt: null });
		await auditService.record({
			actor,
			action: "flag.killSwitch.cleared",
			entityType: "flag",
			entityId: flag._id,
			entityLabel: flag.key,
			projectId: project._id,
			summary: `${actor.name} cleared the kill switch on ${flag.key}.`,
			metadata: { previousReason: flag.killSwitch.reason },
		});
		return decorateFlag(updated);
	},
};
