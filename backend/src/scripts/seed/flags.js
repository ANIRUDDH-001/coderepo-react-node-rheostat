import { normalizeConfig } from "../../features/flags/config-diff.js";
import { validateEnvConfig } from "../../features/flags/config-validation.js";
import { initialConfig } from "../../features/flags/env-config.js";
import { FlagVersion } from "../../features/flags/flag-version.model.js";
import { Flag } from "../../features/flags/flag.model.js";
import { ENVIRONMENT_KEYS } from "../../features/projects/project.model.js";
import { flagCatalog } from "./catalog.js";
import { daysAgo, daysFromNow } from "./clock.js";

const ACTOR_EMAILS = {
	priya: "priya.raman@rheostat.team",
	marcus: "marcus.chen@rheostat.team",
	elena: "elena.novak@rheostat.team",
	diego: "diego.alvarez@rheostat.team",
	sam: "sam.okafor@rheostat.team",
};

const VERSION_ACTIONS = {
	direct: "flag.config.updated",
	promotion: "flag.promoted",
	rollback: "flag.rolledBack",
	rollout: "rollout.stepApplied",
	changeRequest: "changeRequest.applied",
};

const envName = (project, key) => project.environments.find((environment) => environment.key === key).name;

// Turns one catalog definition into a Flag document, its FlagVersions, and the audit entries that explain them.
function buildFlag(definition, project, segmentKeys, people) {
	const person = (name) => people.byEmail.get(ACTOR_EMAILS[name]);
	const creator = person(definition.createdBy);
	const createdAt = daysAgo(definition.createdDaysAgo, 9);
	const draft = { key: definition.key, variations: definition.variations, environments: {} };
	const first = initialConfig(draft);
	const environments = Object.fromEntries(
		ENVIRONMENT_KEYS.map((key) => [key, { ...first, lastEffectiveChangeAt: createdAt, lastChangedBy: creator._id }]),
	);
	const flagId = new Flag()._id;
	const versions = ENVIRONMENT_KEYS.map((environment) => ({
		flagId,
		projectId: project._id,
		environment,
		version: 1,
		config: normalizeConfig(first),
		actorId: creator._id,
		reason: "Flag created",
		source: "create",
		createdAt,
		updatedAt: createdAt,
	}));
	const audit = [
		{
			projectId: project._id,
			actorId: creator._id,
			action: "flag.created",
			entityType: "flag",
			entityId: String(flagId),
			entityLabel: definition.key,
			summary: `${creator.name} created flag ${definition.key} (${definition.type}).`,
			metadata: { key: definition.key, type: definition.type },
			at: createdAt,
		},
	];
	let updatedAt = createdAt;

	for (const entry of definition.history) {
		validateEnvConfig(entry.config, draft, segmentKeys);
		const actor = person(entry.actor);
		const at = daysAgo(entry.daysAgo, 11);
		const decision = normalizeConfig(entry.config);
		const current = environments[entry.env];
		const version = current.version + 1;
		environments[entry.env] = { ...decision, version, lastEffectiveChangeAt: at, lastChangedBy: actor._id };
		versions.push({
			flagId,
			projectId: project._id,
			environment: entry.env,
			version,
			config: decision,
			actorId: actor._id,
			reason: entry.reason,
			source: entry.source,
			createdAt: at,
			updatedAt: at,
		});
		audit.push({
			projectId: project._id,
			actorId: actor._id,
			action: VERSION_ACTIONS[entry.source],
			entityType: "flag",
			entityId: String(flagId),
			entityLabel: definition.key,
			summary: `${actor.name} ${describe(entry.source)} ${definition.key} in ${envName(project, entry.env)}: ${entry.reason}`,
			metadata: { environment: entry.env, version, reason: entry.reason },
			at,
		});
		if (at > updatedAt) updatedAt = at;
	}

	let killSwitch = { active: false, reason: "", actorId: null, activatedAt: null };
	for (const event of definition.killSwitch || []) {
		const actor = person(event.actor);
		const at = daysAgo(event.daysAgo, 15);
		const activated = event.action === "activated";
		audit.push({
			projectId: project._id,
			actorId: actor._id,
			action: activated ? "flag.killSwitch.activated" : "flag.killSwitch.cleared",
			entityType: "flag",
			entityId: String(flagId),
			entityLabel: definition.key,
			summary: activated
				? `${actor.name} activated the kill switch on ${definition.key}: ${event.reason}`
				: `${actor.name} cleared the kill switch on ${definition.key}.`,
			metadata: activated ? { reason: event.reason } : { previousReason: killSwitch.reason },
			at,
		});
		killSwitch = activated
			? { active: true, reason: event.reason, actorId: actor._id, activatedAt: at }
			: { active: false, reason: "", actorId: null, activatedAt: null };
		if (at > updatedAt) updatedAt = at;
	}

	let archivedState = { archived: false, archivedAt: null, archivedBy: null };
	if (definition.archived) {
		const actor = person(definition.archived.actor);
		const at = daysAgo(definition.archived.daysAgo, 16);
		archivedState = { archived: true, archivedAt: at, archivedBy: actor._id };
		audit.push({
			projectId: project._id,
			actorId: actor._id,
			action: "flag.archived",
			entityType: "flag",
			entityId: String(flagId),
			entityLabel: definition.key,
			summary: `${actor.name} archived flag ${definition.key}.`,
			metadata: {},
			at,
		});
		if (at > updatedAt) updatedAt = at;
	}

	const flag = {
		_id: flagId,
		projectId: project._id,
		key: definition.key,
		name: definition.name,
		description: definition.description,
		type: definition.type,
		variations: definition.variations,
		tags: definition.tags,
		ownerId: person(definition.owner)._id,
		lifecycle: {
			kind: definition.lifecycle.kind,
			removeBy: definition.lifecycle.removeByDays === null ? null : daysFromNow(definition.lifecycle.removeByDays, 9),
		},
		...archivedState,
		killSwitch,
		environments,
		createdBy: creator._id,
		createdAt,
		updatedAt,
	};
	return { flag, versions, audit };
}

const describe = (source) =>
	({
		direct: "updated",
		promotion: "promoted",
		rollback: "rolled back",
		rollout: "advanced the rollout of",
		changeRequest: "applied a change request to",
	})[source];

export async function seedFlags(projects, segments, people) {
	console.log("\nSeeding flags and version history...");
	const built = flagCatalog.map((definition) => {
		const project = projects.byKey.get(definition.project);
		const segmentKeys = new Set((segments.byProject.get(definition.project) || []).map((segment) => segment.key));
		return buildFlag(definition, project, segmentKeys, people);
	});
	const flags = await Flag.insertMany(built.map((item) => item.flag));
	const versions = await FlagVersion.insertMany(built.flatMap((item) => item.versions));
	console.log(`  Created ${flags.length} flags and ${versions.length} flag versions`);
	return { flags, versions, audit: built.flatMap((item) => item.audit), byKey: new Map(flags.map((flag) => [flag.key, flag])) };
}
