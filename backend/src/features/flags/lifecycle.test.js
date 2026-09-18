import { describe, expect, test } from "bun:test";
import { STALE_AFTER_DAYS, isFullyRolledOut, staleState } from "./lifecycle.js";

const day = 24 * 60 * 60 * 1000;
const now = new Date("2026-09-18T12:00:00Z");
const daysAgo = (days) => new Date(now.getTime() - days * day);
const env = (overrides = {}) => ({ enabled: false, offVariationId: "v_off", rules: [], fallthrough: { variationId: "v_on" }, lastEffectiveChangeAt: daysAgo(20), ...overrides });
const flag = (envs, lifecycle = { kind: "temporary", removeBy: null }) => ({ lifecycle, environments: { development: env(), staging: env(), production: env(), ...envs } });

describe("isFullyRolledOut", () => {
	test("all environments disabled counts as fully rolled out (everyone gets one variation)", () => {
		expect(isFullyRolledOut(flag({}))).toBe(true);
	});
	test("enabled with no rules and a fixed fallthrough is fully rolled out", () => {
		expect(isFullyRolledOut(flag({ production: env({ enabled: true }) }))).toBe(true);
	});
	test("a rule in any environment means not fully rolled out", () => {
		expect(isFullyRolledOut(flag({ staging: env({ enabled: true, rules: [{ id: "r1", clauses: [], serve: { variationId: "v_on" } }] }) }))).toBe(false);
	});
	test("a rollout fallthrough means not fully rolled out", () => {
		const rollout = { rollout: { bucketBy: "key", weights: [{ variationId: "v_on", weight: 50000 }, { variationId: "v_off", weight: 50000 }] } };
		expect(isFullyRolledOut(flag({ production: env({ enabled: true, fallthrough: rollout }) }))).toBe(false);
	});
});

describe("staleState", () => {
	test("permanent flags are never ready to remove or overdue", () => {
		expect(staleState(flag({}, { kind: "permanent", removeBy: null }), now)).toMatchObject({ readyToRemove: false, overdue: false });
	});
	test("temporary, fully rolled out, and untouched for 20 days is ready to remove", () => {
		expect(staleState(flag({}), now)).toMatchObject({ readyToRemove: true, overdue: false, fullyRolledOut: true });
	});
	test("a change 10 days ago in any environment resets readiness", () => {
		expect(staleState(flag({ staging: env({ lastEffectiveChangeAt: daysAgo(10) }) }), now).readyToRemove).toBe(false);
	});
	test(`the threshold is exactly ${STALE_AFTER_DAYS} days`, () => {
		expect(staleState(flag({ production: env({ lastEffectiveChangeAt: daysAgo(STALE_AFTER_DAYS) }) }), now).readyToRemove).toBe(true);
		expect(staleState(flag({ production: env({ lastEffectiveChangeAt: daysAgo(STALE_AFTER_DAYS - 0.5) }) }), now).readyToRemove).toBe(false);
	});
	test("removeBy in the past is overdue even when not fully rolled out", () => {
		const withRule = flag({ production: env({ enabled: true, rules: [{ id: "r1", clauses: [], serve: { variationId: "v_on" } }] }) }, { kind: "temporary", removeBy: daysAgo(1) });
		expect(staleState(withRule, now)).toMatchObject({ readyToRemove: false, overdue: true });
	});
	test("both flags can be true at once and the latest change timestamp is reported", () => {
		const both = flag({ development: env({ lastEffectiveChangeAt: daysAgo(30) }) }, { kind: "temporary", removeBy: daysAgo(2) });
		expect(staleState(both, now)).toEqual({ fullyRolledOut: true, readyToRemove: true, overdue: true, lastEffectiveChangeAt: daysAgo(20) });
	});
	test("metadata edits do not count: only lastEffectiveChangeAt matters", () => {
		const withUpdatedAt = { ...flag({}), updatedAt: now, name: "Renamed" };
		expect(staleState(withUpdatedAt, now).readyToRemove).toBe(true);
	});
});
