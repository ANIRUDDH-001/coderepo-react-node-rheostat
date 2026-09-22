import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AttemptTimeline } from "./AttemptTimeline.jsx";

const attempts = [
	{ at: "2026-09-21T10:00:00Z", outcome: "failed", durationMs: 5, responseStatus: 503 },
	{ at: "2026-09-21T10:00:30Z", outcome: "failed", durationMs: 5003, error: "timeout" },
];
describe("AttemptTimeline", () => {
	test("lists attempts with status, duration, error, and the next attempt", () => {
		const html = renderToStaticMarkup(<AttemptTimeline attempts={attempts} budgetFrom={0} nextAttemptAt="2026-09-21T10:02:30Z" status="pending" />);
		expect(html).toContain("Attempt 1");
		expect(html).toContain("HTTP 503");
		expect(html).toContain("5 ms");
		expect(html).toContain("timeout");
		expect(html).toContain("5003 ms");
		expect(html).toContain("Next attempt");
	});
	test("marks where a redelivery restarted the budget", () => {
		const html = renderToStaticMarkup(<AttemptTimeline attempts={attempts} budgetFrom={1} nextAttemptAt={null} status="delivered" />);
		expect(html).toContain("Redelivered");
	});
	test("dead deliveries show the dead-letter note instead of a next attempt", () => {
		const html = renderToStaticMarkup(<AttemptTimeline attempts={[]} budgetFrom={0} nextAttemptAt={null} status="dead" />);
		expect(html).toContain("Dead-lettered");
		expect(html).not.toContain("Next attempt");
	});
});
