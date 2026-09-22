import { readCache } from "../api/cache.js";

// State transitions of useAsync, kept pure so they can be tested without rendering.
export function initialStateFor(key, staleMs, now = Date.now()) {
	const cached = key ? readCache(key) : null;
	if (!cached) return { data: null, error: null, loading: true, revalidating: false, fresh: false };
	const fresh = now - cached.at < staleMs;
	return { data: cached.data, error: null, loading: false, revalidating: !fresh, fresh };
}
export const starting = (previous) => ({ ...previous, error: null, loading: previous.data === null, revalidating: previous.data !== null });
export const settled = (previous, { data, error }) =>
	error
		? { ...previous, error, loading: false, revalidating: false }
		: { data, error: null, loading: false, revalidating: false, fresh: true };

export function mutationOutcome({ currentKey, callbackKey, commit = false, generation = { current: 0 } }) {
	if (currentKey !== callbackKey) return "ignored";
	if (commit) generation.current += 1;
	return "applied";
}
