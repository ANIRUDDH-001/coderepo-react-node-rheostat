import { request } from "../../shared/api/client.js";

export const dashboardApi = {
	get: (projectKey) => request(`/projects/${encodeURIComponent(projectKey)}/dashboard`),
};
