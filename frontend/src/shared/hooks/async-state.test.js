import { describe, expect, test } from "bun:test";
import { clearCache, writeCache } from "../api/cache.js";
import { initialStateFor, mutationOutcome, settled, starting } from "./async-state.js";

describe("async-state", () => {
	test("no key or no cache → loading with no data", () => {
		clearCache();
		expect(initialStateFor(null, 30000)).toMatchObject({ data: null, loading: true, revalidating: false });
		expect(initialStateFor("missing", 30000)).toMatchObject({ data: null, loading: true });
	});
	test("fresh cache → data, no loading, no revalidation; stale cache → revalidating", () => {
		clearCache();
		writeCache("k", [1]);
		expect(initialStateFor("k", 30000)).toMatchObject({ data: [1], loading: false, revalidating: false, fresh: true });
		expect(initialStateFor("k", 30000, Date.now() + 31000)).toMatchObject({
			data: [1],
			loading: false,
			revalidating: true,
			fresh: false,
		});
	});
	test("a key change to an uncached key drops the old data and shows loading", () => {
		clearCache();
		writeCache("a", ["A"]);
		const first = initialStateFor("a", 30000);
		const afterSwitch = initialStateFor("b", 30000);
		expect(first.data).toEqual(["A"]);
		expect(afterSwitch).toMatchObject({ data: null, loading: true });
	});
	test("starting keeps data while revalidating; settled replaces or records the error", () => {
		const s = starting({ data: [1], error: null, loading: false, revalidating: false });
		expect(s).toMatchObject({ data: [1], loading: false, revalidating: true });
		expect(settled(s, { data: [2] })).toMatchObject({ data: [2], loading: false, revalidating: false });
		expect(settled(s, { error: new Error("x") })).toMatchObject({ data: [1], loading: false, revalidating: false });
	});
});

describe("mutation races", () => {
	test("a mutation callback for key A is ignored once the hook is on key B", () => {
		expect(mutationOutcome({ currentKey: "b", callbackKey: "a" })).toBe("ignored");
		expect(mutationOutcome({ currentKey: "a", callbackKey: "a" })).toBe("applied");
	});
	test("a committed mutation bumps the generation so an older GET is discarded", () => {
		const generation = { current: 3 };
		const olderGet = generation.current; // GET started before the commit
		mutationOutcome({ currentKey: "a", callbackKey: "a", commit: true, generation });
		expect(generation.current).toBe(4);
		expect(olderGet === generation.current).toBe(false); // settled() would be skipped by run()
	});
});
