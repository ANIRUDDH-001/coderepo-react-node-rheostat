import { useCallback, useEffect, useRef, useState } from "react";
import { dedupe, writeCache } from "../api/cache.js";
import { initialStateFor, settled, starting } from "./async-state.js";

export function useAsync(loader, dependencies = [], { key = null, staleMs = 30000 } = {}) {
	const [state, setState] = useState(() => initialStateFor(key, staleMs));
	const generation = useRef(0);
	const keyRef = useRef(key);
	// A key change while mounted resets synchronously to that key's cached state (or loading), never the old key's data.
	if (keyRef.current !== key) {
		keyRef.current = key;
		generation.current += 1;
		setState(initialStateFor(key, staleMs));
	}
	const run = useCallback(async () => {
		const current = (generation.current += 1);
		setState(starting);
		try {
			const data = key ? await dedupe(key, loader) : await loader();
			if (current === generation.current) setState((previous) => settled(previous, { data }));
		} catch (error) {
			if (current === generation.current) setState((previous) => settled(previous, { error }));
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, dependencies);
	useEffect(() => {
		if (state.fresh && state.data !== null && !state.loading && !state.revalidating) return;
		run();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [run]);
	// `mutate` changes hook state. It is pure (no side effects inside the React updater), ignores calls that arrive
	// after the hook moved to another key, and a `commit` (authoritative server data) writes the cache outside the
	// updater and bumps the load generation so an older in-flight GET cannot overwrite the committed value.
	const dataRef = useRef(state.data);
	dataRef.current = state.data;
	const mutate = useCallback(
		(updater, { commit = false } = {}) => {
			if (keyRef.current !== key) return false;
			const data = typeof updater === "function" ? updater(dataRef.current) : updater;
			dataRef.current = data;
			if (commit) {
				generation.current += 1;
				if (key) writeCache(key, data);
			}
			setState((previous) => ({ ...previous, data, ...(commit ? { fresh: true } : {}) }));
			return true;
		},
		[key],
	);
	return { data: state.data, error: state.error, loading: state.loading, revalidating: state.revalidating, reload: run, mutate };
}

export function useDebouncedValue(value, delay = 300) {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const timer = window.setTimeout(() => setDebounced(value), delay);
		return () => window.clearTimeout(timer);
	}, [value, delay]);
	return debounced;
}
