import { request } from "../../shared/api/client.js";

const base = (projectKey) => `/projects/${encodeURIComponent(projectKey)}/saved-views`;

export const savedViewApi = {
	list: (projectKey) => request(base(projectKey)),
	create: (projectKey, input) => request(base(projectKey), { method: "POST", body: JSON.stringify(input) }),
	update: (id, patch) => request(`/saved-views/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
	remove: (id) => request(`/saved-views/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

// The flags list keeps filters as URL strings; a saved view stores them typed. These two convert between the shapes.
export function filtersToView(filters) {
	return {
		query: filters.query || "",
		type: filters.type || "",
		stale: filters.stale || "any",
		environment: filters.environment || "",
		state: filters.environment ? filters.state || "any" : "any",
		tags: filters.tags ? filters.tags.split(",").filter(Boolean) : [],
		archived: filters.archived === "true",
	};
}

export function viewToFilters(view) {
	const filters = view.filters || {};
	return {
		query: filters.query || "",
		type: filters.type || "",
		stale: filters.stale || "any",
		environment: filters.environment || "",
		state: filters.state || "any",
		tags: (filters.tags || []).join(","),
		archived: filters.archived ? "true" : "false",
		sort: view.sort || "updated",
		page: "",
	};
}
