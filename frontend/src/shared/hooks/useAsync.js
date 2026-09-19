import { useCallback, useEffect, useRef, useState } from "react";

// Loads data for a page: `{ data, error, loading, reload }`. Stale responses are ignored when inputs change.
export function useAsync(loader, dependencies = []) {
	const [state, setState] = useState({ data: null, error: null, loading: true });
	const generation = useRef(0);
	const run = useCallback(async () => {
		const current = (generation.current += 1);
		setState((previous) => ({ ...previous, error: null, loading: true }));
		try {
			const data = await loader();
			if (current === generation.current) setState({ data, error: null, loading: false });
		} catch (error) {
			if (current === generation.current) setState((previous) => ({ data: previous.data, error, loading: false }));
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, dependencies);
	useEffect(() => {
		run();
	}, [run]);
	const mutate = useCallback((updater) => setState((previous) => ({ ...previous, data: typeof updater === "function" ? updater(previous.data) : updater })), []);
	return { ...state, reload: run, mutate };
}

export function useDebouncedValue(value, delay = 300) {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const timer = window.setTimeout(() => setDebounced(value), delay);
		return () => window.clearTimeout(timer);
	}, [value, delay]);
	return debounced;
}
