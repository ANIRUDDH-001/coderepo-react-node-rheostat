import { describe, expect, test } from "bun:test";
import { ROLES } from "../../shared/auth/permissions.js";
import { assertNoActiveRollout, promotionPayload, routeForWrite, withRuleIds } from "./governance.service.js";

const activePlan = { _id: "65f000000000000000000001", status: "running", currentPercent: 50 };

describe("assertNoActiveRollout", () => {
	test("passes when no plan is active", () => {
		expect(() => assertNoActiveRollout(null, false)).not.toThrow();
		expect(() => assertNoActiveRollout(undefined, undefined)).not.toThrow();
	});

	test("throws 409 ROLLOUT_ACTIVE with plan details when not acknowledged", () => {
		try {
			assertNoActiveRollout(activePlan, false);
			throw new Error("expected to throw");
		} catch (error) {
			expect(error.statusCode).toBe(409);
			expect(error.code).toBe("ROLLOUT_ACTIVE");
			expect(error.details).toEqual({ planId: "65f000000000000000000001", currentPercent: 50, status: "running" });
		}
	});

	test("passes when the caller acknowledges the active rollout", () => {
		expect(() => assertNoActiveRollout(activePlan, true)).not.toThrow();
	});
});

describe("routeForWrite", () => {
	const unprotected = { key: "development", protected: false };
	const protectedEnv = { key: "production", protected: true };

	test("protected environments always route through a change request", () => {
		for (const role of ROLES) expect(routeForWrite(protectedEnv, { role })).toBe("changeRequest");
	});

	test("unprotected environments are direct for contributors only", () => {
		expect(routeForWrite(unprotected, { role: "admin" })).toBe("direct");
		expect(routeForWrite(unprotected, { role: "releaseManager" })).toBe("direct");
		expect(routeForWrite(unprotected, { role: "reviewer" })).toBe("direct");
		expect(routeForWrite(unprotected, { role: "developer" })).toBe("direct");
		expect(routeForWrite(unprotected, { role: "viewer" })).toBe("changeRequest");
	});
});

describe("promotionPayload", () => {
	test("strips bookkeeping fields and keeps the decision configuration", () => {
		const payload = promotionPayload({
			_id: "x",
			version: 7,
			lastEffectiveChangeAt: new Date(),
			lastChangedBy: "someone",
			enabled: true,
			offVariationId: "v_false",
			rules: [
				{
					id: "r_1",
					description: "beta",
					clauses: [{ attribute: "plan", operator: "in", values: ["pro"] }],
					serve: { variationId: "v_true" },
				},
			],
			fallthrough: {
				rollout: {
					weights: [
						{ variationId: "v_true", weight: 25000 },
						{ variationId: "v_false", weight: 75000 },
					],
				},
			},
		});
		expect(Object.keys(payload).sort()).toEqual(["enabled", "fallthrough", "offVariationId", "rules"]);
		expect(payload.rules[0].clauses[0].negate).toBe(false);
		expect(payload.fallthrough.rollout.bucketBy).toBe("key");
	});
});

describe("withRuleIds", () => {
	test("assigns ids to new rules and keeps existing ones", () => {
		const config = withRuleIds({ enabled: true, rules: [{ id: "r_keep" }, { description: "new" }] });
		expect(config.rules[0].id).toBe("r_keep");
		expect(config.rules[1].id).toMatch(/^r_[a-f0-9]{8}$/);
		expect(config.enabled).toBe(true);
	});
});
