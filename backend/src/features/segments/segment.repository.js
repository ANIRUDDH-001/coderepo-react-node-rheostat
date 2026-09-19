import { Segment } from "./segment.model.js";

export const segmentRepository = {
	findByProject: (projectId) => Segment.find({ projectId }).sort({ name: 1 }).lean(),
	findByKey: (projectId, key) => Segment.findOne({ projectId, key }).lean(),
	create: (input) => Segment.create(input).then((document) => document.toObject()),
	update: (id, patch) => Segment.findByIdAndUpdate(id, { $set: patch }, { new: true, runValidators: true }).lean(),
	remove: (id) => Segment.findByIdAndDelete(id).lean(),
	insertMany: (documents) => Segment.insertMany(documents),
};
