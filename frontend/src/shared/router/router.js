import { useCallback, useMemo, useSyncExternalStore } from "react";
import { buildPath, matchRoute, parseQuery, stringifyQuery } from "./match.js";

// A tiny History-API router: one module-level store, `useSyncExternalStore`, and popstate.
const listeners = new Set();
let snapshot = { path: window.location.pathname, search: window.location.search };

const readLocation = () => {
	const next = { path: window.location.pathname, search: window.location.search };
	if (next.path !== snapshot.path || next.search !== snapshot.search) snapshot = next;
	return snapshot;
};

const emit = () => {
	readLocation();
	for (const listener of listeners) listener();
};

window.addEventListener("popstate", emit);

export function navigate(to, { replace = false } = {}) {
	const current = `${window.location.pathname}${window.location.search}`;
	if (to === current) return;
	window.history[replace ? "replaceState" : "pushState"](null, "", to);
	emit();
}

const subscribe = (listener) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};

export function useRoute() {
	const location = useSyncExternalStore(subscribe, readLocation, readLocation);
	const route = useMemo(() => matchRoute(location.path), [location.path]);
	const query = useMemo(() => parseQuery(location.search), [location.search]);
	const setQuery = useCallback(
		(patch, { replace = true } = {}) => {
			const next = { ...parseQuery(window.location.search), ...patch };
			navigate(`${window.location.pathname}${stringifyQuery(next)}`, { replace });
		},
		[],
	);
	return { path: location.path, name: route.name, params: route.params, query, navigate, setQuery, buildPath };
}
