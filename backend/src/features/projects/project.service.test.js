import { describe, expect, test } from "bun:test";
import { defaultEnvironments, environmentOf, mergeEnvironmentPatches } from "./project.service.js";

describe("project helpers", () => {
	test("default environments are development, staging, and protected production", () => {
		const environments = defaultEnvironments();
		expect(environments.map((environment) => environment.key)).toEqual(["development", "staging", "production"]);
		expect(environments.find((environment) => environment.key === "production")).toMatchObject({ protected: true, requiredApprovals: 1 });
		expect(environments.filter((environment) => environment.protected)).toHaveLength(1);
	});

	test("environmentOf finds by key and throws 404 otherwise", () => {
		const project = { environments: defaultEnvironments() };
		expect(environmentOf(project, "staging").name).toBe("Staging");
		expect(() => environmentOf(project, "qa")).toThrow(expect.objectContaining({ statusCode: 404, code: "ENVIRONMENT_NOT_FOUND" }));
	});

	test("mergeEnvironmentPatches only changes policy fields and keeps keys immutable", () => {
		const merged = mergeEnvironmentPatches(defaultEnvironments(), [{ key: "production", protected: false, requiredApprovals: 2 }]);
		expect(merged.map((environment) => environment.key)).toEqual(["development", "staging", "production"]);
		expect(merged[2]).toMatchObject({ protected: false, requiredApprovals: 2, name: "Production" });
		expect(() => mergeEnvironmentPatches(defaultEnvironments(), [{ key: "qa", protected: true }])).toThrow(expect.objectContaining({ statusCode: 422 }));
	});
});
