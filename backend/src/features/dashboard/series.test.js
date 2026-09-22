import { describe, expect, test } from "bun:test";
import { dailySeries, topFlagDistributions } from "./series.js";

const day = (offset) => new Date(Date.UTC(2026, 8, 8 + offset, 12));

describe("dailySeries", () => {
	test("fills every day in the window with zeros and keeps counts by source", () => {
		const rows = [
			{ day: "2026-09-09", source: "simulated", count: 40 },
			{ day: "2026-09-09", source: "playground", count: 2 },
			{ day: "2026-09-12", source: "simulated", count: 7 },
		];
		const series = dailySeries(rows, day(0), day(5));
		expect(series).toHaveLength(5);
		expect(series[0]).toEqual({ date: "2026-09-08", playground: 0, simulated: 0 });
		expect(series[1]).toEqual({ date: "2026-09-09", playground: 2, simulated: 40 });
		expect(series[4]).toEqual({ date: "2026-09-12", playground: 0, simulated: 7 });
	});

	test("ignores rows outside the window and unknown sources", () => {
		const rows = [
			{ day: "2026-09-01", source: "simulated", count: 5 },
			{ day: "2026-09-08", source: "other", count: 5 },
		];
		expect(dailySeries(rows, day(0), day(2))).toEqual([
			{ date: "2026-09-08", playground: 0, simulated: 0 },
			{ date: "2026-09-09", playground: 0, simulated: 0 },
		]);
	});

	test("returns an empty series for an empty window", () => {
		expect(dailySeries([], day(0), day(0))).toEqual([]);
	});
});

describe("topFlagDistributions", () => {
	const flags = [
		{
			key: "alpha",
			variations: [
				{ id: "v_true", name: "True" },
				{ id: "v_false", name: "False" },
			],
		},
		{ key: "beta", variations: [{ id: "v_a", name: "A" }] },
	];
	test("groups counts per flag with variation names, sorted by total, limited", () => {
		const rows = [
			{ flagKey: "alpha", variationId: "v_true", count: 30 },
			{ flagKey: "alpha", variationId: "v_false", count: 10 },
			{ flagKey: "beta", variationId: "v_a", count: 50 },
			{ flagKey: "gone", variationId: "v_x", count: 99 },
		];
		const result = topFlagDistributions(rows, flags, 1);
		expect(result).toEqual([{ flagKey: "beta", total: 50, variations: [{ variationId: "v_a", name: "A", count: 50 }] }]);
		const both = topFlagDistributions(rows, flags, 8);
		expect(both.map((entry) => entry.flagKey)).toEqual(["beta", "alpha"]);
		expect(both[1].variations).toEqual([
			{ variationId: "v_true", name: "True", count: 30 },
			{ variationId: "v_false", name: "False", count: 10 },
		]);
	});

	test("merges environments for the same flag and variation", () => {
		const rows = [
			{ flagKey: "alpha", environment: "production", variationId: "v_true", count: 3 },
			{ flagKey: "alpha", environment: "staging", variationId: "v_true", count: 4 },
		];
		expect(topFlagDistributions(rows, flags, 8)[0].variations[0].count).toBe(7);
	});
});
