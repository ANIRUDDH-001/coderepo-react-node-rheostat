// Human-readable summaries of delivery attempts, shared by the tab, the detail page, and the drawer.
export const describeAttempt = (attempt) => {
	if (!attempt) return "—";
	const what = attempt.responseStatus ? `HTTP ${attempt.responseStatus}` : attempt.error || attempt.outcome;
	return `${what} · ${attempt.durationMs} ms`;
};

// Toast text for a test delivery: the row comes back after its first attempt.
export const describeTest = (delivery) => {
	const attempt = delivery.lastAttempt || delivery.attempts?.at(-1);
	if (delivery.status === "delivered") return `Test delivered (HTTP ${attempt?.responseStatus ?? 200} in ${attempt?.durationMs ?? 0} ms)`;
	const why = attempt?.responseStatus ? `HTTP ${attempt.responseStatus}` : attempt?.error || "no response";
	return `Test failed: ${why} — ${delivery.status === "dead" ? "dead-lettered" : "retrying"}`;
};
