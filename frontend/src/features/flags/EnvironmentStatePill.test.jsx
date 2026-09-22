import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { EnvironmentStatePill } from "./EnvironmentStatePill.jsx";

const environment = { key: "production", name: "Production", color: "#c00" };
const summary = (overrides) => ({ enabled: false, version: 3, ruleCount: 0, fallthrough: { kind: "fixed", label: "True" }, ...overrides });

describe("EnvironmentStatePill", () => {
	test("off state", () => {
		const html = renderToStaticMarkup(<EnvironmentStatePill environment={environment} summary={summary()} />);
		expect(html).toContain("Off");
		expect(html).toContain("badge-neutral");
		expect(html).toContain("Production: Off (v3)");
	});
	test("on state names the served variation and counts rules", () => {
		const html = renderToStaticMarkup(
			<EnvironmentStatePill environment={environment} summary={summary({ enabled: true, ruleCount: 2 })} />,
		);
		expect(html).toContain("On · True");
		expect(html).toContain("2 rules");
		expect(html).toContain("badge-success");
	});
	test("rollout fallthrough shows the split with the info tone", () => {
		const html = renderToStaticMarkup(
			<EnvironmentStatePill
				environment={environment}
				summary={summary({ enabled: true, ruleCount: 1, fallthrough: { kind: "rollout", label: "True 25% · False 75%" } })}
			/>,
		);
		expect(html).toContain("True 25% · False 75%");
		expect(html).toContain("1 rule<");
		expect(html).toContain("badge-info");
	});
});
