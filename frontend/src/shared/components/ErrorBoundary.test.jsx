import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppErrorFallback, ErrorBoundary, RouteErrorFallback } from "./ErrorBoundary.jsx";

describe("ErrorBoundary", () => {
	test("getDerivedStateFromError stores the error", () => {
		const error = new Error("boom");
		expect(ErrorBoundary.getDerivedStateFromError(error)).toEqual({ error });
	});
	test("renders children when nothing failed", () => {
		const html = renderToStaticMarkup(<ErrorBoundary fallback={() => <p>fallback</p>}><p>content</p></ErrorBoundary>);
		expect(html).toContain("content");
		expect(html).not.toContain("fallback");
	});
	test("route fallback names the error and offers retry and dashboard", () => {
		const html = renderToStaticMarkup(<RouteErrorFallback error={new Error("Cannot read x")} onRetry={() => {}} projectKey="storefront" />);
		expect(html).toContain('id="route-error-title"');
		expect(html).toContain("This page ran into a problem");
		expect(html).toContain("Cannot read x");
		expect(html).toContain("Try again");
		expect(html).toContain("/projects/storefront/dashboard");
	});
	test("app fallback offers a reload", () => {
		expect(renderToStaticMarkup(<AppErrorFallback error={new Error("x")} />)).toContain("Reload Rheostat");
	});
});
