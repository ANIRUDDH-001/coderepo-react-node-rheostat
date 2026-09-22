import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RolloutTimeline } from "./RolloutTimeline.jsx";

const plan = (overrides = {}) => ({
	status: "running",
	currentPercent: 10,
	heldByKillSwitch: false,
	steps: [
		{ id: "s1", percent: 10, startAt: "2026-09-20T10:00:00Z", status: "applied" },
		{ id: "s2", percent: 50, startAt: "2026-09-23T10:00:00Z", status: "pending" },
		{ id: "s3", percent: 100, startAt: "2026-09-25T10:00:00Z", status: "pending" },
	],
	...overrides,
});

describe("RolloutTimeline", () => {
	test("draws one circle per step, a now line, and accessible svg text", () => {
		const html = renderToStaticMarkup(<RolloutTimeline plan={plan()} />);
		expect(html.match(/<circle /g)).toHaveLength(3);
		expect(html).toContain('class="rollout-now"');
		expect(html).toContain("<title");
		expect(html).toContain("<desc");
		expect(html).toContain('role="img"');
		expect(html).toContain("Current audience: 10%");
	});
	test("applied steps carry the applied status class and colour", () => {
		const html = renderToStaticMarkup(<RolloutTimeline plan={plan()} />);
		expect(html).toContain("rollout-status-applied");
		expect(html).toContain('fill="var(--success)"');
		expect(html.match(/rollout-status-pending/g)).toHaveLength(2);
	});
	test("kill switch and stall notices", () => {
		expect(renderToStaticMarkup(<RolloutTimeline plan={plan({ heldByKillSwitch: true })} />)).toContain(
			"held by the active kill switch",
		);
		expect(renderToStaticMarkup(<RolloutTimeline plan={plan({ status: "stalled" })} />)).toContain("stalled because targeting changed");
	});
});
