import { toObjectIdPredicate } from "./cursor.js";
import { WebhookDelivery } from "./webhook-delivery.model.js";
import { WebhookReceipt } from "./webhook-receipt.model.js";
import { WebhookSubscription } from "./webhook-subscription.model.js";

export const subscriptionRepository = {
	findById: (id) => WebhookSubscription.findById(id).lean(),
	findByProject: (projectId) => WebhookSubscription.find({ projectId }).sort({ createdAt: -1 }).lean(),
	findEnabledByProject: (projectId) => WebhookSubscription.find({ projectId, enabled: true }).lean(),
	findDisabledIds: () =>
		WebhookSubscription.find({ enabled: false })
			.select("_id")
			.lean()
			.then((rows) => rows.map((row) => row._id)),
	countByProject: (projectId) => WebhookSubscription.countDocuments({ projectId }),
	create: (input) => WebhookSubscription.create(input).then((document) => document.toObject()),
	update: (id, patch) => WebhookSubscription.findByIdAndUpdate(id, { $set: patch }, { new: true, runValidators: true }).lean(),
	remove: (id) => WebhookSubscription.deleteOne({ _id: id }),
	recordOutcome: (id, outcome, at) =>
		WebhookSubscription.findByIdAndUpdate(
			id,
			outcome === "delivered"
				? { $set: { consecutiveFailures: 0, lastDeliveryAt: at, lastDeliveryStatus: "delivered" } }
				: { $inc: { consecutiveFailures: 1 }, $set: { lastDeliveryAt: at, lastDeliveryStatus: "dead" } },
			{ new: true },
		).lean(),
	disableAuto: (id) =>
		WebhookSubscription.updateOne({ _id: id, enabled: true }, { $set: { enabled: false, disabledReason: "AUTO_FAILURES" } }).then(
			(result) => result.modifiedCount === 1,
		),
	insertMany: (documents) => WebhookSubscription.insertMany(documents),
};

export const deliveryRepository = {
	findById: (id) => WebhookDelivery.findById(id).lean(),
	// Ordered:false so duplicates (unique subscriptionId+eventId) are skipped, not fatal; returns the inserted docs.
	insertMany: async (documents) => {
		try {
			return await WebhookDelivery.insertMany(documents, { ordered: false });
		} catch (error) {
			if (error?.code === 11000 || error?.writeErrors?.every((entry) => entry.code === 11000)) return error.insertedDocs || [];
			throw error;
		}
	},
	// Disabled subscriptions are excluded at claim time so their backlog cannot consume the pass budget.
	claimNext: (now, excludeSubscriptionIds = []) =>
		WebhookDelivery.findOneAndUpdate(
			{
				status: "pending",
				nextAttemptAt: { $lte: now },
				...(excludeSubscriptionIds.length ? { subscriptionId: { $nin: excludeSubscriptionIds } } : {}),
			},
			{ $set: { status: "delivering", claimedAt: now } },
			{ new: true, sort: { nextAttemptAt: 1 } },
		).lean(),
	claimById: (id, now) =>
		WebhookDelivery.findOneAndUpdate(
			{ _id: id, status: "pending" },
			{ $set: { status: "delivering", claimedAt: now } },
			{ new: true },
		).lean(),
	releaseStale: (before) =>
		WebhookDelivery.updateMany({ status: "delivering", claimedAt: { $lt: before } }, { $set: { status: "pending", claimedAt: null } }),
	finish: (id, patch) => WebhookDelivery.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean(),
	requeue: (id, now, budgetFrom) =>
		WebhookDelivery.findByIdAndUpdate(
			id,
			{ $set: { status: "pending", nextAttemptAt: now, claimedAt: null, budgetFrom } },
			{ new: true },
		).lean(),
	holdPending: (subscriptionId) => WebhookDelivery.updateMany({ subscriptionId, status: "pending" }, { $set: { status: "held" } }),
	releaseHeld: (subscriptionId, now) =>
		WebhookDelivery.updateMany({ subscriptionId, status: "held" }, { $set: { status: "pending", nextAttemptAt: now } }),
	findPage: (subscriptionId, { status, cursor, limit }) =>
		WebhookDelivery.find({ subscriptionId, ...(status ? { status } : {}), ...(cursor ? toObjectIdPredicate(cursor) : {}) })
			.sort({ createdAt: -1, _id: -1 })
			.limit(limit + 1)
			.lean(),
	countByStatus: (filter) => WebhookDelivery.aggregate([{ $match: filter }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
	removeForSubscription: (subscriptionId) => WebhookDelivery.deleteMany({ subscriptionId }),
	insertManySeed: (documents) => WebhookDelivery.insertMany(documents),
};

export const receiptRepository = {
	// One atomic upsert per request: the first receipt for a dedupeKey is inserted, later ones increment receivedCount.
	// A concurrent upsert race on the unique index surfaces as 11000; one retry resolves it.
	record: async (document, attempt = 0) => {
		const { lastReceivedAt: _last, receivedCount: _count, ...insertOnly } = document;
		try {
			const receipt = await WebhookReceipt.findOneAndUpdate(
				{ projectId: document.projectId, dedupeKey: document.dedupeKey },
				// A path may appear in only one operator: lastReceivedAt is $set and receivedCount is $inc (1 on insert).
				{
					$setOnInsert: { ...insertOnly, firstReceivedAt: document.lastReceivedAt },
					$set: { lastReceivedAt: document.lastReceivedAt },
					$inc: { receivedCount: 1 },
				},
				{ upsert: true, new: true },
			).lean();
			const extra = await WebhookReceipt.find({ projectId: document.projectId })
				.sort({ lastReceivedAt: -1 })
				.skip(50)
				.select("_id")
				.lean();
			if (extra.length) await WebhookReceipt.deleteMany({ _id: { $in: extra.map((entry) => entry._id) } });
			return receipt;
		} catch (error) {
			if (error?.code === 11000 && attempt === 0) return receiptRepository.record(document, 1);
			throw error;
		}
	},
	findRecent: (projectId) => WebhookReceipt.find({ projectId }).sort({ lastReceivedAt: -1 }).limit(50).lean(),
	clear: (projectId) => WebhookReceipt.deleteMany({ projectId }),
	insertMany: (documents) => WebhookReceipt.insertMany(documents),
};
