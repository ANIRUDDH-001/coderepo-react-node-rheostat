import { invalidate } from "../../shared/api/cache.js";
import { request } from "../../shared/api/client.js";

const refresh = (promise) => promise.then((result) => (invalidate("projects"), result));

export const projectApi = {
	list: () => request("/projects"),
	get: (projectKey) => request(`/projects/${encodeURIComponent(projectKey)}`),
	create: (input) => refresh(request("/projects", { method: "POST", body: JSON.stringify(input) })),
	update: (projectKey, input) =>
		refresh(request(`/projects/${encodeURIComponent(projectKey)}`, { method: "PATCH", body: JSON.stringify(input) })),
};
