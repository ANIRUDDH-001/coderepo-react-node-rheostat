import { request } from "../../shared/api/client.js";
import { stringifyQuery } from "../../shared/router/match.js";

export const evaluationApi = {
	evaluate: (projectKey, body) =>
		request(`/projects/${encodeURIComponent(projectKey)}/evaluate`, { method: "POST", body: JSON.stringify(body) }),
	audience: (projectKey, { search = "", limit = 20 } = {}) =>
		request(`/projects/${encodeURIComponent(projectKey)}/audience${stringifyQuery({ search, limit })}`),
};
