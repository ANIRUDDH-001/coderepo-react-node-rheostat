import { invalidate } from "../../shared/api/cache.js";
import { request } from "../../shared/api/client.js";
import { stringifyQuery } from "../../shared/router/match.js";

const base = (projectKey) => `/projects/${encodeURIComponent(projectKey)}/rollouts`;
const post = (path, body) => request(path, { method: "POST", body: JSON.stringify(body ?? {}) });
// Rollout transitions change flag configurations; plan-scoped calls carry no project key, so every flag list is dropped.
const refresh = (prefix, promise) => promise.then((result) => (invalidate(prefix), result));

export const rolloutApi = {
	list: (projectKey, filters = {}) => request(`${base(projectKey)}${stringifyQuery(filters)}`),
	create: (projectKey, input) => refresh(`flags:${projectKey}`, post(base(projectKey), input)),
	get: (id) => request(`/rollouts/${encodeURIComponent(id)}`),
	pause: (id) => refresh("flags:", post(`/rollouts/${encodeURIComponent(id)}/pause`)),
	resume: (id) => refresh("flags:", post(`/rollouts/${encodeURIComponent(id)}/resume`)),
	abort: (id) => refresh("flags:", post(`/rollouts/${encodeURIComponent(id)}/abort`)),
};
