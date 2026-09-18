import { Person } from "./person.model.js";

export const personRepository = {
	findProfileById: (id) => Person.findOne({ _id: id, isProfile: true }).lean(),
	findById: (id) => Person.findById(id).lean(),
	listProfiles: () => Person.find({ isProfile: true }).sort({ sortOrder: 1, name: 1 }).lean(),
	findByIds: (ids) => Person.find({ _id: { $in: ids } }).lean(),
	search: (expression, limit) =>
		Person.find(expression ? { $or: [{ name: expression }, { email: expression }] } : {})
			.sort({ sortOrder: 1, name: 1 })
			.limit(limit)
			.lean(),
	countByRole: (role) => Person.countDocuments({ role, isProfile: true }),
	updateRole: (id, role) => Person.findByIdAndUpdate(id, { role }, { new: true, runValidators: true }).lean(),
};
