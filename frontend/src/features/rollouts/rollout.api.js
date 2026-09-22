import { request } from "../../shared/api/client.js";
import { stringifyQuery } from "../../shared/router/match.js";

const base = (projectKey) => `/projects/${encodeURIComponent(projectKey)}/rollouts`;
const post = (path, body) => request(path, { method: "POST", body: JSON.stringify(body ?? {}) });

export const rolloutApi = {
	list: (projectKey, filters = {}) => request(`${base(projectKey)}${stringifyQuery(filters)}`),
	create: (projectKey, input) => post(base(projectKey), input),
	get: (id) => request(`/rollouts/${encodeURIComponent(id)}`),
	pause: (id) => post(`/rollouts/${encodeURIComponent(id)}/pause`),
	resume: (id) => post(`/rollouts/${encodeURIComponent(id)}/resume`),
	abort: (id) => post(`/rollouts/${encodeURIComponent(id)}/abort`),
};
