import { afterEach, expect, test } from "bun:test";

const previousFetch = globalThis.fetch;
const storage = new Map();

globalThis.localStorage = {
	getItem: (key) => storage.get(key) || null,
	setItem: (key, value) => storage.set(key, String(value)),
	removeItem: (key) => storage.delete(key),
};

afterEach(() => {
	globalThis.fetch = previousFetch;
});

test("rollout API posts the plan and addresses project and plan transitions", async () => {
	const calls = [];
	globalThis.fetch = async (url, options) => {
		calls.push({ url, options });
		return new Response(JSON.stringify({ data: { _id: "plan-1" } }), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	};

	const { rolloutApi } = await import("./rollout.api.js");
	const input = { flagKey: "new-checkout", environment: "production", bucketBy: "key", steps: [] };
	await rolloutApi.create("mobile app", input);
	await rolloutApi.resume("plan-1");

	expect(calls).toHaveLength(2);
	expect(calls[0].url).toBe("/api/v1/projects/mobile%20app/rollouts");
	expect(calls[0].options.method).toBe("POST");
	expect(calls[0].options.body).toBe(JSON.stringify(input));
	expect(calls[1].url).toBe("/api/v1/rollouts/plan-1/resume");
	expect(calls[1].options.method).toBe("POST");
});
