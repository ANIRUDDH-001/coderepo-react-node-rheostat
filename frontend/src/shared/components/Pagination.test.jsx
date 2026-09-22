import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Pagination } from "./Pagination.jsx";

describe("Pagination", () => {
	test("first page: range, page count, previous disabled", () => {
		const html = renderToStaticMarkup(<Pagination onPage={() => {}} page={1} pageSize={20} total={45} />);
		expect(html).toContain("1–20 of 45");
		expect(html).toContain("Page 1 of 3");
		expect(html).toMatch(/aria-label="Previous page"[^>]*disabled=""/);
		expect(html).not.toMatch(/aria-label="Next page"[^>]*disabled=""/);
	});
	test("last page: next disabled and the range is clipped to the total", () => {
		const html = renderToStaticMarkup(<Pagination onPage={() => {}} page={3} pageSize={20} total={45} />);
		expect(html).toContain("41–45 of 45");
		expect(html).toMatch(/aria-label="Next page"[^>]*disabled=""/);
	});
	test("renders nothing when there are no rows", () => {
		expect(renderToStaticMarkup(<Pagination onPage={() => {}} page={1} pageSize={20} total={0} />)).toBe("");
	});
});
