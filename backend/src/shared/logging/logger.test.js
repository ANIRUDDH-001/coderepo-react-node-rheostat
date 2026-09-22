import { describe, expect, test } from "bun:test";
import { createLogger, serializeError } from "./logger.js";

const capture = () => {
	const lines = [];
	return { lines, write: (line) => lines.push(JSON.parse(line)) };
};

describe("logger", () => {
	test("writes one JSON line with ts, level, event and fields", () => {
		const out = capture();
		createLogger({ level: "info", write: out.write }).info("http.request", { method: "GET", status: 200 });
		expect(out.lines).toHaveLength(1);
		expect(out.lines[0]).toMatchObject({ level: "info", event: "http.request", method: "GET", status: 200 });
		expect(typeof out.lines[0].ts).toBe("string");
	});
	test("drops lines below the configured level", () => {
		const out = capture();
		const log = createLogger({ level: "warn", write: out.write });
		log.info("ignored", {});
		log.warn("kept", {});
		expect(out.lines.map((line) => line.event)).toEqual(["kept"]);
	});
	test("serializes Error fields", () => {
		const out = capture();
		createLogger({ write: out.write }).error("x", { error: Object.assign(new Error("boom"), { code: "X" }) });
		expect(out.lines[0].error).toMatchObject({ name: "Error", message: "boom", code: "X" });
		expect(out.lines[0].error.stack).toContain("boom");
		expect(serializeError("plain")).toEqual({ name: "Error", message: "plain" });
	});
});
