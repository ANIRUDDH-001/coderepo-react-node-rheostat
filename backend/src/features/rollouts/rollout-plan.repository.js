import { ACTIVE_STATUSES } from "./plan.js";
import { RolloutPlan } from "./rollout-plan.model.js";

export const rolloutPlanRepository = {
	findById: (id) => RolloutPlan.findById(id).lean(),
	findPage: (filter, skip, limit) => RolloutPlan.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
	count: (filter) => RolloutPlan.countDocuments(filter),
	findActive: (filter = {}) =>
		RolloutPlan.find({ ...filter, status: { $in: ACTIVE_STATUSES } })
			.sort({ createdAt: -1 })
			.lean(),
	findActiveForFlag: (flagId, environment) => RolloutPlan.findOne({ flagId, environment, status: { $in: ACTIVE_STATUSES } }).lean(),
	create: (input) => RolloutPlan.create(input).then((document) => document.toObject()),
	insertMany: (documents) => RolloutPlan.insertMany(documents),
	// Reconciler queries (spec §5.5).
	findDue: (now) =>
		RolloutPlan.find({
			status: { $in: ["scheduled", "running"] },
			steps: { $elemMatch: { status: "pending", startAt: { $lte: now } } },
		}).lean(),
	findStaleClaims: (before) => RolloutPlan.find({ steps: { $elemMatch: { status: "applying", claimedAt: { $lt: before } } } }).lean(),
	claimStep: (planId, stepId, at) =>
		RolloutPlan.updateOne(
			{ _id: planId, steps: { $elemMatch: { id: stepId, status: "pending" } } },
			{ $set: { "steps.$.status": "applying", "steps.$.claimedAt": at } },
		).then((result) => result.modifiedCount === 1),
	releaseStep: (planId, stepId) =>
		RolloutPlan.updateOne(
			{ _id: planId, steps: { $elemMatch: { id: stepId, status: "applying" } } },
			{ $set: { "steps.$.status": "pending" }, $unset: { "steps.$.claimedAt": "" } },
		),
	markApplied: (planId, stepId, version, at) =>
		RolloutPlan.findOneAndUpdate(
			{ _id: planId, "steps.id": stepId },
			{
				$set: {
					"steps.$.status": "applied",
					"steps.$.appliedVersion": version,
					"steps.$.appliedAt": at,
					expectedVersion: version,
					lastAppliedStepId: stepId,
					status: "running",
					stallReason: null,
				},
				$unset: { "steps.$.claimedAt": "" },
			},
			{ new: true },
		).lean(),
	stall: (planId, reason, at) =>
		RolloutPlan.updateOne(
			{ _id: planId, status: { $in: ACTIVE_STATUSES } },
			{ $set: { status: "stalled", stallReason: reason, stalledAt: at } },
		),
	complete: (planId, at) => RolloutPlan.updateOne({ _id: planId }, { $set: { status: "completed", resolvedAt: at } }),
	// Interactive transitions persist the whole steps array (resume shifts dates, abort skips).
	save: (planId, patch) => RolloutPlan.findByIdAndUpdate(planId, { $set: patch }, { new: true, runValidators: true }).lean(),
};
