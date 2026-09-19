import { request } from "../../shared/api/client.js";

const base = (projectKey) => `/projects/${encodeURIComponent(projectKey)}/segments`;

export const segmentApi = {
	list: (projectKey) => request(base(projectKey)),
	get: (projectKey, segmentKey) => request(`${base(projectKey)}/${encodeURIComponent(segmentKey)}`),
	create: (projectKey, input) => request(base(projectKey), { method: "POST", body: JSON.stringify(input) }),
	update: (projectKey, segmentKey, input) =>
		request(`${base(projectKey)}/${encodeURIComponent(segmentKey)}`, { method: "PATCH", body: JSON.stringify(input) }),
	remove: (projectKey, segmentKey) => request(`${base(projectKey)}/${encodeURIComponent(segmentKey)}`, { method: "DELETE" }),
};
