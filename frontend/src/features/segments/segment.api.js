import { invalidate } from "../../shared/api/cache.js";
import { request } from "../../shared/api/client.js";

// Segment lists are cached per project; every mutation drops that project entry.
const refresh = (projectKey, promise) => promise.then((result) => (invalidate(`segments:${projectKey}`), result));

const base = (projectKey) => `/projects/${encodeURIComponent(projectKey)}/segments`;

export const segmentApi = {
	list: (projectKey) => request(base(projectKey)),
	get: (projectKey, segmentKey) => request(`${base(projectKey)}/${encodeURIComponent(segmentKey)}`),
	create: (projectKey, input) => refresh(projectKey, request(base(projectKey), { method: "POST", body: JSON.stringify(input) })),
	update: (projectKey, segmentKey, input) =>
		refresh(
			projectKey,
			request(`${base(projectKey)}/${encodeURIComponent(segmentKey)}`, { method: "PATCH", body: JSON.stringify(input) }),
		),
	remove: (projectKey, segmentKey) =>
		refresh(projectKey, request(`${base(projectKey)}/${encodeURIComponent(segmentKey)}`, { method: "DELETE" })),
};
