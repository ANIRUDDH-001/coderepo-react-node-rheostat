import { escapeRegex } from "../../shared/utils/keys.js";
import { AudienceMember } from "./audience-member.model.js";

export const audienceMemberRepository = {
	findAll: (projectId) => AudienceMember.find({ projectId }).sort({ key: 1 }).lean(),
	search: (projectId, search, limit) => {
		const filter = { projectId };
		if (search) {
			const expression = { $regex: escapeRegex(search), $options: "i" };
			filter.$or = [{ key: expression }, { name: expression }, { "attributes.company": expression }];
		}
		return AudienceMember.find(filter).sort({ name: 1 }).limit(limit).lean();
	},
	count: (projectId) => AudienceMember.countDocuments({ projectId }),
	insertMany: (documents) => AudienceMember.insertMany(documents),
};
