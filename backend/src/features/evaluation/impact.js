// Pure impact summary: evaluates every audience member before and after a proposed change. No persistence.
import { REASONS } from "./evaluator.js";

export const SAMPLE_LIMIT = 20;

export const attributionKey = (reason) => {
	if (reason.kind === REASONS.RULE_MATCH) return reason.ruleId || `rule-${reason.ruleIndex}`;
	if (reason.kind === REASONS.KILL_SWITCH) return "killSwitch";
	if (reason.kind === REASONS.OFF) return "off";
	if (reason.kind === REASONS.FALLTHROUGH) return "fallthrough";
	return "error";
};

const increment = (counts, key) => {
	counts[key] = (counts[key] || 0) + 1;
};

export function summarizeImpact(audience, evaluateBefore, evaluateAfter) {
	const summary = { audienceSize: audience.length, before: {}, after: {}, flipped: 0, flippedSample: [], attribution: { after: {} } };
	for (const member of audience) {
		const context = { key: member.key, attributes: member.attributes };
		const before = evaluateBefore(context);
		const after = evaluateAfter(context);
		increment(summary.before, String(before.variationId));
		increment(summary.after, String(after.variationId));
		increment(summary.attribution.after, attributionKey(after.reason));
		if (before.variationId !== after.variationId) {
			summary.flipped += 1;
			if (summary.flippedSample.length < SAMPLE_LIMIT) {
				summary.flippedSample.push({
					key: member.key,
					name: member.name,
					attributes: member.attributes,
					before: { variationId: before.variationId, reason: before.reason },
					after: { variationId: after.variationId, reason: after.reason },
				});
			}
		}
	}
	return summary;
}
