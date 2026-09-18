import { Project } from "./project.model.js";

export const projectRepository = {
	list: () => Project.find({}).sort({ sortOrder: 1, name: 1 }).lean(),
	findByKey: (key) => Project.findOne({ key }).lean(),
	findById: (id) => Project.findById(id).lean(),
	create: (input) => Project.create(input).then((document) => document.toObject()),
	update: (id, patch) => Project.findByIdAndUpdate(id, patch, { new: true, runValidators: true }).lean(),
	count: () => Project.countDocuments(),
};
