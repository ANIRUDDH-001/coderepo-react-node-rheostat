import { describe, expect, test } from "bun:test";
import { ROLES, assertCan, can, permissionsFor } from "./permissions.js";

describe("permissions", () => {
	test("declares the five roles", () => {
		expect(ROLES).toEqual(["admin", "releaseManager", "reviewer", "developer", "viewer"]);
	});

	test("viewer can read and evaluate but not create", () => {
		expect(can("viewer", "flag:read")).toBe(true);
		expect(can("viewer", "playground:evaluate")).toBe(true);
		expect(can("viewer", "savedView:manageOwn")).toBe(true);
		expect(can("viewer", "flag:create")).toBe(false);
		expect(can("viewer", "changeRequest:comment")).toBe(false);
	});

	test("developer edits config only in unprotected environments", () => {
		expect(can("developer", "flag:editConfig", { environment: { protected: false } })).toBe(true);
		expect(can("developer", "flag:editConfig", { environment: { protected: true } })).toBe(false);
		expect(can("admin", "flag:editConfig", { environment: { protected: true } })).toBe(false);
		expect(can("developer", "flag:editConfig")).toBe(false);
	});

	test("rollout:manage in protected env needs release manager or admin", () => {
		expect(can("developer", "rollout:manage", { environment: { protected: false } })).toBe(true);
		expect(can("developer", "rollout:manage", { environment: { protected: true } })).toBe(false);
		expect(can("reviewer", "rollout:manage", { environment: { protected: true } })).toBe(false);
		expect(can("releaseManager", "rollout:manage", { environment: { protected: true } })).toBe(true);
		expect(can("admin", "rollout:manage", { environment: { protected: true } })).toBe(true);
	});

	test("changeRequest:apply allowed for author or release manager/admin", () => {
		expect(can("developer", "changeRequest:apply", { isAuthor: true })).toBe(true);
		expect(can("developer", "changeRequest:apply", { isAuthor: false })).toBe(false);
		expect(can("reviewer", "changeRequest:apply", { isAuthor: false })).toBe(false);
		expect(can("releaseManager", "changeRequest:apply", { isAuthor: false })).toBe(true);
		expect(can("admin", "changeRequest:apply", { isAuthor: false })).toBe(true);
		expect(can("viewer", "changeRequest:apply", { isAuthor: true })).toBe(false);
	});

	test("review, kill switch, archive, and project management follow the matrix", () => {
		expect(can("developer", "changeRequest:review")).toBe(false);
		expect(can("reviewer", "changeRequest:review")).toBe(true);
		expect(can("reviewer", "flag:killSwitch")).toBe(false);
		expect(can("releaseManager", "flag:killSwitch")).toBe(true);
		expect(can("releaseManager", "flag:archive")).toBe(true);
		expect(can("releaseManager", "project:manage")).toBe(false);
		expect(can("admin", "project:manage")).toBe(true);
		expect(can("admin", "people:manageRoles")).toBe(true);
	});

	test("unknown roles and actions are denied", () => {
		expect(can("owner", "flag:read")).toBe(false);
		expect(can("admin", "flag:teleport")).toBe(false);
	});

	test("assertCan throws 403 FORBIDDEN with the action in details", () => {
		expect(() => assertCan({ role: "viewer" }, "flag:create")).toThrow(
			expect.objectContaining({ statusCode: 403, code: "FORBIDDEN", details: { action: "flag:create" } }),
		);
		expect(() => assertCan({ role: "developer" }, "flag:create")).not.toThrow();
	});

	test("permissionsFor lists granted context-free actions plus environment-qualified variants", () => {
		const reviewer = permissionsFor("reviewer");
		expect(reviewer).toContain("changeRequest:review");
		expect(reviewer).toContain("flag:editConfig:unprotected");
		expect(reviewer).toContain("rollout:manage:unprotected");
		expect(reviewer).not.toContain("rollout:manage:protected");
		expect(reviewer).not.toContain("flag:editConfig");
		expect(permissionsFor("viewer")).not.toContain("flag:killSwitch");
		expect(permissionsFor("admin")).toContain("rollout:manage:protected");
		expect(permissionsFor("unknown")).toEqual([]);
	});
	test("webhooks: everyone reads, release managers and admins manage", () => {
		expect(can("viewer", "webhook:read")).toBe(true);
		expect(can("developer", "webhook:manage")).toBe(false);
		expect(can("reviewer", "webhook:manage")).toBe(false);
		expect(can("releaseManager", "webhook:manage")).toBe(true);
		expect(can("admin", "webhook:manage")).toBe(true);
		expect(permissionsFor("releaseManager")).toContain("webhook:manage");
		expect(permissionsFor("viewer")).toContain("webhook:read");
	});
});
