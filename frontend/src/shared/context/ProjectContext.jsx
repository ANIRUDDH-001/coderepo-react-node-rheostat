import { createContext, useContext } from "react";

export const PROJECT_KEY = "rheostat-project";

export const readLastProject = () => {
	try {
		return localStorage.getItem(PROJECT_KEY) || "";
	} catch {
		return "";
	}
};

export const rememberProject = (key) => {
	try {
		localStorage.setItem(PROJECT_KEY, key);
	} catch {
		// Storage can be unavailable; the switcher still works for the session.
	}
};

const ProjectContext = createContext({ project: null, projects: [], reloadProjects: () => {} });

export const ProjectProvider = ProjectContext.Provider;
export const useProject = () => useContext(ProjectContext);

export const environmentOf = (project, key) => project?.environments?.find((environment) => environment.key === key) || null;
