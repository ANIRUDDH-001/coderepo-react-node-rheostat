import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DeliveryStatusBadge, StatusBadge } from "./StatusBadge.jsx";

describe("webhook badges", () => {
	test("subscription states", () => {
		expect(renderToStaticMarkup(<StatusBadge subscription={{ enabled: true }} />)).toContain("Enabled");
		expect(renderToStaticMarkup(<StatusBadge subscription={{ enabled: false, disabledReason: "MANUAL" }} />)).toContain("Disabled");
		const auto = renderToStaticMarkup(<StatusBadge subscription={{ enabled: false, disabledReason: "AUTO_FAILURES" }} />);
		expect(auto).toContain("Auto-disabled");
		expect(auto).toContain("badge-danger");
	});
	test("delivery states map to tones and labels", () => {
		expect(renderToStaticMarkup(<DeliveryStatusBadge status="delivered" />)).toContain("badge-success");
		expect(renderToStaticMarkup(<DeliveryStatusBadge status="dead" />)).toContain("Dead-lettered");
		expect(renderToStaticMarkup(<DeliveryStatusBadge status="pending" />)).toContain("Retrying");
		expect(renderToStaticMarkup(<DeliveryStatusBadge status="held" />)).toContain("Held");
	});
});
