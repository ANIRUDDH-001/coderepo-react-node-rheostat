import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { KindBadge, StatusBadge } from "./StatusBadge.jsx";

describe("change request badges", () => {
	test.each([
		["pending", "Pending review", "badge-info"],
		["approved", "Approved", "badge-success"],
		["conflicted", "Conflicted", "badge-warning"],
		["applied", "Applied", "badge-success"],
		["rejected", "Rejected", "badge-danger"],
		["withdrawn", "Withdrawn", "badge-neutral"],
	])("%s → %s (%s)", (status, label, tone) => {
		const html = renderToStaticMarkup(<StatusBadge status={status} />);
		expect(html).toContain(label);
		expect(html).toContain(tone);
	});
	test("kinds are labeled", () => {
		expect(renderToStaticMarkup(<KindBadge kind="manual" />)).toContain("Targeting change");
		expect(renderToStaticMarkup(<KindBadge kind="promotion" />)).toContain("Promotion");
		expect(renderToStaticMarkup(<KindBadge kind="rollback" />)).toContain("Rollback");
	});
});
