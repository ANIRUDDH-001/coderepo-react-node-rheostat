export const ROLE_LABELS = {
	admin: "Admin",
	releaseManager: "Release manager",
	reviewer: "Reviewer",
	developer: "Developer",
	viewer: "Viewer",
};

export const roleLabel = (role) => ROLE_LABELS[role] || role;
