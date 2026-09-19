import { ChangeRequest } from "./change-request.model.js";

export const changeRequestRepository = {
	findById: (id) => ChangeRequest.findById(id).lean(),
	findPage: (filter, skip, limit) => ChangeRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
	count: (filter) => ChangeRequest.countDocuments(filter),
	findOpen: (filter) => ChangeRequest.find({ ...filter, status: { $in: ["pending", "approved", "conflicted"] } }).sort({ createdAt: -1 }).lean(),
	create: (input) => ChangeRequest.create(input).then((document) => document.toObject()),
	// Persists the fields the state machine may change; everything else is immutable after creation.
	save: (id, next) =>
		ChangeRequest.findByIdAndUpdate(
			id,
			{
				$set: {
					status: next.status,
					title: next.title,
					description: next.description,
					proposedConfig: next.proposedConfig,
					baseVersion: next.baseVersion,
					reviews: next.reviews,
					comments: next.comments,
					appliedVersion: next.appliedVersion ?? null,
					appliedAt: next.appliedAt ?? null,
					appliedBy: next.appliedBy ?? null,
					resolvedAt: next.resolvedAt ?? null,
				},
			},
			{ new: true, runValidators: true },
		).lean(),
	insertMany: (documents) => ChangeRequest.insertMany(documents),
};
