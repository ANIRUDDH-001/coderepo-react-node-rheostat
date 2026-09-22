import { invalidate } from "../../shared/api/cache.js";
import { request } from "../../shared/api/client.js";

const base = (projectKey) => `/projects/${encodeURIComponent(projectKey)}/saved-views`;
// Views are cached per project; view-scoped calls carry no project key, so every project entry is dropped.
const refresh = (promise) => promise.then((result) => (invalidate("saved-views:"), result));

export const savedViewApi = {
	list: (projectKey) => request(base(projectKey)),
	create: (projectKey, input) => refresh(request(base(projectKey), { method: "POST", body: JSON.stringify(input) })),
	update: (id, patch) => refresh(request(`/saved-views/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) })),
	remove: (id) => refresh(request(`/saved-views/${encodeURIComponent(id)}`, { method: "DELETE" })),
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
