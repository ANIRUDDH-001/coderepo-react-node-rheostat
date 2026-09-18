import { ENVIRONMENT_KEYS } from "../projects/project.model.js";
import { Flag } from "./flag.model.js";

const path = (environment, field) => `environments.${environment}.${field}`;

export const flagRepository = {
	findByKey: (projectId, key) => Flag.findOne({ projectId, key }).lean(),
	findById: (id) => Flag.findById(id).lean(),
	findPage: (filter, sort, skip, limit) => Flag.find(filter).sort(sort).skip(skip).limit(limit).lean(),
	count: (filter) => Flag.countDocuments(filter),
	findActiveByProject: (projectId) => Flag.find({ projectId, archived: false }).sort({ key: 1 }).lean(),
	findAllByProject: (projectId) => Flag.find({ projectId }).sort({ key: 1 }).lean(),
	create: (input) => Flag.create(input).then((document) => document.toObject()),
	updateMetadata: (id, patch) => Flag.findByIdAndUpdate(id, { $set: patch }, { new: true, runValidators: true }).lean(),
	setArchived: (id, archived, actorId, now = new Date()) =>
		Flag.findByIdAndUpdate(id, { $set: { archived, archivedAt: archived ? now : null, archivedBy: archived ? actorId : null } }, { new: true }).lean(),
	setKillSwitch: (id, state) => Flag.findByIdAndUpdate(id, { $set: { killSwitch: state } }, { new: true }).lean(),
	// The single guarded write that changes an environment configuration (spec §5.13).
	// `fields` is the full decision config for interactive writes, or `{ fallthrough }` for rollout steps.
	mutateEnvironment: (id, environment, expectedVersion, fields, actorId, now = new Date()) =>
		Flag.findOneAndUpdate(
			{ _id: id, [path(environment, "version")]: expectedVersion },
			{
				$set: {
					...Object.fromEntries(Object.entries(fields).map(([field, value]) => [path(environment, field), value])),
					[path(environment, "lastEffectiveChangeAt")]: now,
					[path(environment, "lastChangedBy")]: actorId,
				},
				$inc: { [path(environment, "version")]: 1 },
			},
			{ new: true, runValidators: true },
		).lean(),
	countReferencingSegment: (projectId, segmentKey) =>
		Flag.countDocuments({
			projectId,
			$or: ENVIRONMENT_KEYS.map((environment) => ({
				[path(environment, "rules")]: { $elemMatch: { clauses: { $elemMatch: { operator: "segmentMatch", values: segmentKey } } } },
			})),
		}),
	insertMany: (documents) => Flag.insertMany(documents),
};
