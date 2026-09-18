import { WorkspaceAccount } from "./workspace-account.model.js";

export const authRepository = {
	findActiveByEmailWithPassword: (email) => WorkspaceAccount.findOne({ email, active: true }).select("+passwordHash"),
	findActiveById: (id) => WorkspaceAccount.findOne({ _id: id, active: true }).lean(),
};
