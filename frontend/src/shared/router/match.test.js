import { describe, expect, test } from "bun:test";
import { buildPath, matchPath, matchRoute, parseQuery, stringifyQuery } from "./match.js";

describe("matchPath", () => {
	test("extracts named params", () => {
		expect(matchPath("/projects/:projectKey/flags/:flagKey", "/projects/storefront/flags/new-checkout")).toEqual({
			projectKey: "storefront",
			flagKey: "new-checkout",
		});
	});

	test("tolerates a trailing slash and decodes values", () => {
		expect(matchPath("/projects/:projectKey/flags", "/projects/storefront/flags/")).toEqual({ projectKey: "storefront" });
		expect(matchPath("/segments/:key", "/segments/eu%20users")).toEqual({ key: "eu users" });
	});

	test("returns null when the shape differs", () => {
		expect(matchPath("/projects/:projectKey/flags", "/projects/storefront")).toBeNull();
		expect(matchPath("/projects/:projectKey/flags", "/projects/storefront/flags/extra")).toBeNull();
		expect(matchPath("/", "/projects")).toBeNull();
		expect(matchPath("/", "/")).toEqual({});
	});

	test("matchRoute resolves the webhook detail route", () => {
		expect(matchRoute("/projects/storefront/webhooks/abc")).toEqual({ name: "webhook", params: { projectKey: "storefront", id: "abc" } });
	});
});

describe("query helpers", () => {
	test("parseQuery reads a search string into an object", () => {
		expect(parseQuery("?env=production&tab=history")).toEqual({ env: "production", tab: "history" });
		expect(parseQuery("")).toEqual({});
		expect(parseQuery("?q=a%20b")).toEqual({ q: "a b" });
	});

	test("stringifyQuery drops empty values and encodes", () => {
		expect(stringifyQuery({ env: "production", query: "", page: 2, tags: "a b" })).toBe("?env=production&page=2&tags=a+b");
		expect(stringifyQuery({})).toBe("");
	});
});

describe("buildPath", () => {
	test("fills params and appends a query", () => {
		expect(buildPath("flag", { projectKey: "storefront", flagKey: "new-checkout" }, { env: "staging" })).toBe(
			"/projects/storefront/flags/new-checkout?env=staging",
		);
		expect(buildPath("flags", { projectKey: "mobile" })).toBe("/projects/mobile/flags");
	});

	test("encodes param values and rejects unknown routes", () => {
		expect(buildPath("segment", { projectKey: "a b", segmentKey: "x/y" })).toBe("/projects/a%20b/segments/x%2Fy");
		expect(() => buildPath("nope", {})).toThrow();
	});
});
