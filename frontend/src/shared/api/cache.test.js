import { describe, expect, test } from "bun:test";
import { clearCache, currentGeneration, dedupe, invalidate, readCache, writeCache } from "./cache.js";

const later = (value, ms) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

describe("cache", () => {
	test("dedupe shares one in-flight promise per key and caches the result", async () => {
		clearCache();
		let calls = 0;
		const loader = () => later(++calls, 5);
		const [a, b] = await Promise.all([dedupe("k", loader), dedupe("k", loader)]);
		expect([a, b, calls]).toEqual([1, 1, 1]);
		expect(readCache("k").data).toBe(1);
		expect(await dedupe("k", loader)).toBe(2);
	});
	test("write, read, and prefix invalidation", () => {
		clearCache();
		writeCache("segments:storefront", [1]);
		writeCache("segments:mobile", [2]);
		writeCache("projects", []);
		invalidate("segments:");
		expect(readCache("segments:storefront")).toBeNull();
		expect(readCache("segments:mobile")).toBeNull();
		expect(readCache("projects").data).toEqual([]);
	});
	test("a failed loader is not cached and does not stay deduped", async () => {
		clearCache();
		await expect(dedupe("f", () => Promise.reject(new Error("x")))).rejects.toThrow("x");
		expect(readCache("f")).toBeNull();
		expect(await dedupe("f", () => Promise.resolve("ok"))).toBe("ok");
	});
	test("a request started before clearCache cannot populate the new generation", async () => {
		clearCache();
		const generation = currentGeneration();
		const old = dedupe("profiles", () => later(["A"], 10));
		clearCache(); // profile switch
		expect(currentGeneration()).toBe(generation + 1);
		writeCache("profiles", ["B"]);
		expect(await old).toEqual(["A"]);
		expect(readCache("profiles").data).toEqual(["B"]);
	});
	test("in-flight cleanup is identity-safe", async () => {
		clearCache();
		const first = dedupe("k", () => later("first", 10));
		clearCache();
		const second = dedupe("k", () => later("second", 40)); // still in flight when `first` settles
		await first; // its cleanup must not delete `second`
		expect(await dedupe("k", () => later("third", 1))).toBe("second");
		await second;
	});
});
