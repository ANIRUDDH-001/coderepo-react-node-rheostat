// Pure flag evaluation. No persistence, no side effects: the playground, impact preview, and seed all share it.
import { bucketFor } from "../../shared/utils/hash.js";

export const OPERATORS = ["in", "contains", "startsWith", "endsWith", "greaterThan", "lessThan", "before", "after", "segmentMatch"];
export const REASONS = { KILL_SWITCH: "KILL_SWITCH", OFF: "OFF", RULE_MATCH: "RULE_MATCH", FALLTHROUGH: "FALLTHROUGH", ERROR: "ERROR" };

const attributeValue = (context, attribute) => (attribute === "key" ? context.key : context.attributes?.[attribute]);
const isPresent = (value) => value !== undefined && value !== null && value !== "";
const asNumber = (value) =>
	typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
const asTime = (value) => {
	const time = new Date(value).getTime();
	return Number.isNaN(time) ? null : time;
};

function compareClause(operator, actual, values) {
	const text = String(actual);
	switch (operator) {
		case "in":
			return values.some((value) => String(value) === text);
		case "contains":
			return values.some((value) => text.includes(String(value)));
		case "startsWith":
			return values.some((value) => text.startsWith(String(value)));
		case "endsWith":
			return values.some((value) => text.endsWith(String(value)));
		case "greaterThan": {
			const left = asNumber(actual);
			return !Number.isNaN(left) && values.some((value) => !Number.isNaN(asNumber(value)) && left > asNumber(value));
		}
		case "lessThan": {
			const left = asNumber(actual);
			return !Number.isNaN(left) && values.some((value) => !Number.isNaN(asNumber(value)) && left < asNumber(value));
		}
		case "before": {
			const left = asTime(actual);
			return left !== null && values.some((value) => asTime(value) !== null && left < asTime(value));
		}
		case "after": {
			const left = asTime(actual);
			return left !== null && values.some((value) => asTime(value) !== null && left > asTime(value));
		}
		default:
			return false;
	}
}

export function isSegmentMember(segment, context) {
	const key = String(context.key);
	if ((segment.excludedKeys || []).includes(key)) return false;
	if ((segment.includedKeys || []).includes(key)) return true;
	return (segment.rules || []).some((rule) => (rule.clauses || []).every((clause) => matchesClause(clause, context, {})));
}

export function matchesClause(clause, context, segmentsByKey) {
	if (clause.operator === "segmentMatch") {
		const member = (clause.values || []).some((segmentKey) => {
			const segment = segmentsByKey?.[segmentKey];
			return segment ? isSegmentMember(segment, context) : false;
		});
		return clause.negate ? !member : member;
	}
	const actual = attributeValue(context, clause.attribute);
	if (!isPresent(actual)) return false;
	const matched = compareClause(clause.operator, actual, clause.values || []);
	return clause.negate ? !matched : matched;
}

export function serveVariation(serve, flag, environmentKey, context) {
	if (serve?.variationId) return { variationId: serve.variationId };
	const rollout = serve?.rollout;
	if (!rollout) return { variationId: null };
	const bucketValue = rollout.bucketBy && rollout.bucketBy !== "key" ? context.attributes?.[rollout.bucketBy] : undefined;
	const bucket = bucketFor(flag.key, environmentKey, isPresent(bucketValue) ? bucketValue : context.key);
	let cumulative = 0;
	for (const entry of rollout.weights || []) {
		cumulative += entry.weight;
		if (bucket < cumulative) return { variationId: entry.variationId, bucket };
	}
	return { variationId: rollout.weights?.at(-1)?.variationId || null, bucket };
}

function resolve(flag, variationId, reason) {
	const variation = flag.variations.find((candidate) => candidate.id === variationId);
	if (variation) return { variationId: variation.id, value: variation.value, reason };
	const off =
		flag.variations.find((candidate) => candidate.id === flag.environments?.[reason.environmentKey]?.offVariationId) ||
		flag.variations[1] ||
		flag.variations[0];
	return {
		variationId: off?.id ?? null,
		value: off?.value ?? null,
		reason: { kind: REASONS.ERROR, message: `Variation ${variationId} does not exist.` },
	};
}

export function evaluate(flag, environmentKey, context, segmentsByKey = {}) {
	const config = flag.environments?.[environmentKey];
	const offId = config?.offVariationId ?? flag.variations[1]?.id ?? flag.variations[0]?.id;
	if (flag.killSwitch?.active) return resolve(flag, offId, { kind: REASONS.KILL_SWITCH, environmentKey });
	if (!config || !config.enabled) return resolve(flag, offId, { kind: REASONS.OFF, environmentKey });
	const rules = config.rules || [];
	for (let index = 0; index < rules.length; index += 1) {
		const rule = rules[index];
		if ((rule.clauses || []).every((clause) => matchesClause(clause, context, segmentsByKey))) {
			const served = serveVariation(rule.serve, flag, environmentKey, context);
			return resolve(flag, served.variationId, {
				kind: REASONS.RULE_MATCH,
				environmentKey,
				ruleId: rule.id,
				ruleIndex: index,
				...(served.bucket !== undefined ? { bucket: served.bucket } : {}),
			});
		}
	}
	const served = serveVariation(config.fallthrough, flag, environmentKey, context);
	return resolve(flag, served.variationId, {
		kind: REASONS.FALLTHROUGH,
		environmentKey,
		...(served.bucket !== undefined ? { bucket: served.bucket } : {}),
	});
}
