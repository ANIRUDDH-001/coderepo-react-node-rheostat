import { SavedView } from "./saved-view.model.js";

export const savedViewRepository = {
	findByOwner: (ownerId, projectId) => SavedView.find({ ownerId, projectId }).sort({ name: 1 }).lean(),
	findById: (id) => SavedView.findById(id).lean(),
	create: (input) => SavedView.create(input).then((document) => document.toObject()),
	update: (id, patch) => SavedView.findByIdAndUpdate(id, { $set: patch }, { new: true, runValidators: true }).lean(),
	remove: (id) => SavedView.deleteOne({ _id: id }),
	insertMany: (documents) => SavedView.insertMany(documents),
};
