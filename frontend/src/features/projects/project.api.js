import { request } from "../../shared/api/client.js";

export const projectApi = {
	list: () => request("/projects"),
	get: (projectKey) => request(`/projects/${encodeURIComponent(projectKey)}`),
	create: (input) => request("/projects", { method: "POST", body: JSON.stringify(input) }),
	update: (projectKey, input) => request(`/projects/${encodeURIComponent(projectKey)}`, { method: "PATCH", body: JSON.stringify(input) }),
};
