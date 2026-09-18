import { FlagVersion } from "./flag-version.model.js";

export const flagVersionRepository = {
	insert: (document) => FlagVersion.create(document).then((created) => created.toObject()),
	insertMany: (documents) => FlagVersion.insertMany(documents),
	findByFlagAndEnvironment: (flagId, environment) => FlagVersion.find({ flagId, environment }).sort({ version: -1 }).lean(),
	findOne: (flagId, environment, version) => FlagVersion.findOne({ flagId, environment, version }).lean(),
	findByStep: (rolloutPlanId, stepId) => FlagVersion.findOne({ rolloutPlanId, stepId }).lean(),
	findRecent: (projectId, environment, limit) => FlagVersion.find({ projectId, environment }).sort({ createdAt: -1 }).limit(limit).lean(),
	countByFlag: (flagId) => FlagVersion.countDocuments({ flagId }),
};
