// Module-level cache for read-mostly lists plus in-flight deduplication. Keys are explicit ("segments:storefront")
// so invalidation is deliberate. `generation` fences responses that started before a clearCache() (profile switch).
const entries = new Map();
const inflight = new Map();
let generation = 0;

export const currentGeneration = () => generation;
export const readCache = (key) => entries.get(key) || null;
export function writeCache(key, data) {
	entries.set(key, { data, at: Date.now() });
}
export function invalidate(prefix) {
	for (const key of entries.keys()) if (key.startsWith(prefix)) entries.delete(key);
}
export function clearCache() {
	entries.clear();
	inflight.clear();
	generation += 1;
}
export function dedupe(key, loader) {
	if (inflight.has(key)) return inflight.get(key);
	const startedIn = generation;
	const promise = Promise.resolve()
		.then(loader)
		.then((data) => {
			if (startedIn === generation) writeCache(key, data);
			return data;
		})
		.finally(() => {
			if (inflight.get(key) === promise) inflight.delete(key);
		});
	inflight.set(key, promise);
	return promise;
}
