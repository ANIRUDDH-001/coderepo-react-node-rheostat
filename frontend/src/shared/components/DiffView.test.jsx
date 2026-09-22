import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DiffView } from "./DiffView.jsx";

const variations = [
	{ id: "v_true", name: "True" },
	{ id: "v_false", name: "False" },
];
describe("DiffView", () => {
	test("renders changed and added entries with variation names and rule descriptions", () => {
		const html = renderToStaticMarkup(
			<DiffView
				diff={[
					{ path: "enabled", kind: "changed", before: false, after: true },
					{ path: "fallthrough", kind: "changed", before: { variationId: "v_true" }, after: { variationId: "v_false" } },
					{
						path: "rules.r_1",
						kind: "added",
						before: null,
						after: {
							id: "r_1",
							description: "Beta testers",
							clauses: [{ attribute: "key", operator: "segmentMatch", values: ["beta-testers"], negate: false }],
							serve: { variationId: "v_true" },
						},
					},
				]}
				variations={variations}
			/>,
		);
		expect(html).toContain("Targeting");
		expect(html).toContain("Serve True");
		expect(html).toContain("Serve False");
		expect(html).toContain("Beta testers");
		expect(html).toContain("segmentMatch");
	});
	test("empty diff renders the no-change message", () => {
		expect(renderToStaticMarkup(<DiffView diff={[]} variations={variations} />)).toContain("No configuration changes.");
	});
});
