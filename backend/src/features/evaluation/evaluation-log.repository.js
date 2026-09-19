import { EvaluationLog } from "./evaluation-log.model.js";

export const evaluationLogRepository = {
	insertMany: (documents) => EvaluationLog.insertMany(documents),
	count: (projectId) => EvaluationLog.countDocuments({ projectId }),
	countByDay: (projectId, from, to) =>
		EvaluationLog.aggregate([
			{ $match: { projectId, at: { $gte: from, $lt: to } } },
			{ $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$at" } }, count: { $sum: 1 } } },
			{ $sort: { _id: 1 } },
			{ $project: { _id: 0, day: "$_id", count: 1 } },
		]),
	countByFlagVariation: (projectId, from, to) =>
		EvaluationLog.aggregate([
			{ $match: { projectId, at: { $gte: from, $lt: to } } },
			{ $group: { _id: { flagKey: "$flagKey", environment: "$environment", variationId: "$variationId" }, count: { $sum: 1 } } },
			{ $sort: { "_id.flagKey": 1, "_id.environment": 1, count: -1 } },
			{ $project: { _id: 0, flagKey: "$_id.flagKey", environment: "$_id.environment", variationId: "$_id.variationId", count: 1 } },
		]),
	recentForFlag: (flagId, environment, limit) => EvaluationLog.find({ flagId, environment }).sort({ at: -1 }).limit(limit).lean(),
};
