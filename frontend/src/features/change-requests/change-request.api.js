import { request } from "../../shared/api/client.js";
import { stringifyQuery } from "../../shared/router/match.js";

const post = (path, body) => request(path, { method: "POST", body: JSON.stringify(body ?? {}) });

export const changeRequestApi = {
	list: (projectKey, filters = {}) => request(`/projects/${encodeURIComponent(projectKey)}/change-requests${stringifyQuery(filters)}`),
	create: (projectKey, input) => post(`/projects/${encodeURIComponent(projectKey)}/change-requests`, input),
	get: (id) => request(`/change-requests/${id}`),
	edit: (id, patch) => request(`/change-requests/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
	review: (id, decision, comment) => post(`/change-requests/${id}/review`, { decision, comment }),
	apply: (id, acknowledgeActiveRollout = false) =>
		post(`/change-requests/${id}/apply`, acknowledgeActiveRollout ? { acknowledgeActiveRollout: true } : {}),
	rebase: (id) => post(`/change-requests/${id}/rebase`),
	withdraw: (id) => post(`/change-requests/${id}/withdraw`),
	comment: (id, body) => post(`/change-requests/${id}/comments`, { body }),
};
