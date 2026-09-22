import { invalidate } from "../../shared/api/cache.js";
import { request } from "../../shared/api/client.js";
import { stringifyQuery } from "../../shared/router/match.js";

const base = (projectKey) => `/projects/${encodeURIComponent(projectKey)}/flags`;
const flagPath = (projectKey, flagKey) => `${base(projectKey)}/${encodeURIComponent(flagKey)}`;
const environmentPath = (projectKey, flagKey, environment) => `${flagPath(projectKey, flagKey)}/environments/${environment}`;
const post = (path, body) => request(path, { method: "POST", body: JSON.stringify(body ?? {}) });
// Every flag mutation drops the cached flag lists for its project (hardening spec §5, policy 4).
const refresh = (projectKey, promise) => promise.then((result) => (invalidate(`flags:${projectKey}`), result));

export const flagApi = {
	list: (projectKey, filters = {}) => request(`${base(projectKey)}${stringifyQuery(filters)}`),
	create: (projectKey, input) => refresh(projectKey, post(base(projectKey), input)),
	get: (projectKey, flagKey) => request(flagPath(projectKey, flagKey)),
	updateMetadata: (projectKey, flagKey, input) =>
		refresh(projectKey, request(flagPath(projectKey, flagKey), { method: "PATCH", body: JSON.stringify(input) })),
	archive: (projectKey, flagKey) => refresh(projectKey, post(`${flagPath(projectKey, flagKey)}/archive`)),
	restore: (projectKey, flagKey) => refresh(projectKey, post(`${flagPath(projectKey, flagKey)}/restore`)),
	updateEnvironment: (projectKey, flagKey, environment, body) =>
		refresh(projectKey, request(environmentPath(projectKey, flagKey, environment), { method: "PATCH", body: JSON.stringify(body) })),
	versions: (projectKey, flagKey, environment) => request(`${environmentPath(projectKey, flagKey, environment)}/versions`),
	compare: (projectKey, flagKey, environment, source) =>
		request(`${environmentPath(projectKey, flagKey, environment)}/compare?source=${source}`),
	promote: (projectKey, flagKey, environment, body) =>
		refresh(projectKey, post(`${environmentPath(projectKey, flagKey, environment)}/promote`, body)),
	rollback: (projectKey, flagKey, environment, body) =>
		refresh(projectKey, post(`${environmentPath(projectKey, flagKey, environment)}/rollback`, body)),
	impact: (projectKey, flagKey, environment, proposedConfig) =>
		post(`${environmentPath(projectKey, flagKey, environment)}/impact`, { proposedConfig }),
	killSwitch: (projectKey, flagKey, reason) => refresh(projectKey, post(`${flagPath(projectKey, flagKey)}/kill-switch`, { reason })),
	clearKillSwitch: (projectKey, flagKey) =>
		refresh(projectKey, request(`${flagPath(projectKey, flagKey)}/kill-switch`, { method: "DELETE" })),
};
