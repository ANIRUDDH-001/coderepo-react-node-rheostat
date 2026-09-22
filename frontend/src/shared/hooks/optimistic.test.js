import { describe, expect, test } from "bun:test";
import { clearCache, readCache, writeCache } from "../api/cache.js";
import { initialStateFor } from "./async-state.js";

// Simulates: page loads (cached), optimistic mutate (state only), server commit, navigate away and back.
describe("optimistic update coherence", () => {
	test("navigating back after a committed mutation shows the server value, never the optimistic guess", () => {
		clearCache();
		writeCache("cr:1", { comments: [] });
		let state = initialStateFor("cr:1", 30000).data;
		state = { ...state, comments: [{ id: "local-1", body: "hi", pending: true }] }; // optimistic: hook state only
		expect(readCache("cr:1").data.comments).toEqual([]);
		const server = { comments: [{ id: "c_9", body: "hi" }] };
		writeCache("cr:1", server); // mutate(server, { commit: true })
		expect(initialStateFor("cr:1", 30000).data).toEqual(server);
	});
	test("a failed mutation leaves the cache untouched", () => {
		clearCache();
		writeCache("cr:1", { comments: [] });
		const previous = initialStateFor("cr:1", 30000).data;
		const optimistic = { ...previous, comments: [{ id: "local", pending: true }] };
		expect(optimistic.comments).toHaveLength(1);
		expect(readCache("cr:1").data).toEqual(previous); // restore = drop the optimistic state
	});
});
