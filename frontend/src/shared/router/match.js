// Pure route matching; no DOM so it is unit-tested with bun:test.

export const ROUTES = [
	{ name: "home", pattern: "/" },
	{ name: "dashboard", pattern: "/projects/:projectKey/dashboard" },
	{ name: "flags", pattern: "/projects/:projectKey/flags" },
	{ name: "flag", pattern: "/projects/:projectKey/flags/:flagKey" },
	{ name: "segments", pattern: "/projects/:projectKey/segments" },
	{ name: "segmentNew", pattern: "/projects/:projectKey/segments/new" },
	{ name: "segment", pattern: "/projects/:projectKey/segments/:segmentKey" },
	{ name: "changeRequests", pattern: "/projects/:projectKey/change-requests" },
	{ name: "changeRequest", pattern: "/projects/:projectKey/change-requests/:id" },
	{ name: "rollouts", pattern: "/projects/:projectKey/rollouts" },
	{ name: "rollout", pattern: "/projects/:projectKey/rollouts/:id" },
	{ name: "playground", pattern: "/projects/:projectKey/playground" },
	{ name: "audit", pattern: "/projects/:projectKey/audit" },
	{ name: "settings", pattern: "/projects/:projectKey/settings" },
	{ name: "webhook", pattern: "/projects/:projectKey/webhooks/:id" },
];

const segmentsOf = (path) => path.replace(/\/+$/, "").split("/").slice(1);

export function matchPath(pattern, path) {
	const expected = pattern === "/" ? [] : segmentsOf(pattern);
	const actual = path === "/" ? [] : segmentsOf(path);
	if (expected.length !== actual.length) return null;
	const params = {};
	for (let index = 0; index < expected.length; index += 1) {
		const token = expected[index];
		const value = actual[index];
		if (token.startsWith(":")) {
			try {
				params[token.slice(1)] = decodeURIComponent(value);
			} catch {
				params[token.slice(1)] = value;
			}
		} else if (token !== value) return null;
	}
	return params;
}

export function matchRoute(path) {
	for (const route of ROUTES) {
		const params = matchPath(route.pattern, path);
		if (params) return { name: route.name, params };
	}
	return { name: "notFound", params: {} };
}

export function parseQuery(search) {
	const query = {};
	for (const [key, value] of new URLSearchParams(search || "")) query[key] = value;
	return query;
}

export function stringifyQuery(query = {}) {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (value === undefined || value === null || value === "" || value === false) continue;
		params.set(key, String(value));
	}
	const text = params.toString();
	return text ? `?${text}` : "";
}

export function buildPath(name, params = {}, query = {}) {
	const route = ROUTES.find((candidate) => candidate.name === name);
	if (!route) throw new Error(`Unknown route ${name}.`);
	const path = route.pattern.replace(/:([a-zA-Z]+)/g, (_, key) => encodeURIComponent(params[key] ?? ""));
	return `${path}${stringifyQuery(query)}`;
}
