// Client-side draft helpers for environment configurations. Mirrors the backend normalizer so dirty checks are exact.
export const BUCKET_SPACE = 100000;
export const OPERATORS = [
	{ value: "in", label: "is one of" },
	{ value: "contains", label: "contains" },
	{ value: "startsWith", label: "starts with" },
	{ value: "endsWith", label: "ends with" },
	{ value: "greaterThan", label: "is greater than" },
	{ value: "lessThan", label: "is less than" },
	{ value: "before", label: "is before" },
	{ value: "after", label: "is after" },
	{ value: "segmentMatch", label: "is in segment" },
];
export const KNOWN_ATTRIBUTES = ["key", "country", "plan", "platform", "appVersion", "betaOptIn", "signupDate", "company"];

let counter = 0;
export const localId = (prefix) => `${prefix}_${Date.now().toString(36)}${(counter += 1).toString(36)}`;

export const normalizeServe = (serve) =>
	serve?.rollout
		? { rollout: { bucketBy: serve.rollout.bucketBy || "key", weights: (serve.rollout.weights || []).map((entry) => ({ variationId: entry.variationId, weight: entry.weight })) } }
		: { variationId: serve?.variationId ?? null };

export const normalizeConfig = (config) => ({
	enabled: Boolean(config?.enabled),
	offVariationId: config?.offVariationId ?? null,
	rules: (config?.rules || []).map((rule) => ({
		id: rule.id,
		description: rule.description || "",
		clauses: (rule.clauses || []).map((clause) => ({ attribute: clause.attribute, operator: clause.operator, values: [...(clause.values || [])].map(String), negate: Boolean(clause.negate) })),
		serve: normalizeServe(rule.serve),
	})),
	fallthrough: normalizeServe(config?.fallthrough),
});

export const isSameConfig = (left, right) => JSON.stringify(normalizeConfig(left)) === JSON.stringify(normalizeConfig(right));

export const newClause = () => ({ attribute: "plan", operator: "in", values: [], negate: false });
export const newRule = (variationId) => ({ id: localId("r"), description: "", clauses: [newClause()], serve: { variationId } });

export const evenWeights = (variations) => {
	const share = Math.floor(BUCKET_SPACE / variations.length);
	return variations.map((variation, index) => ({ variationId: variation.id, weight: index === variations.length - 1 ? BUCKET_SPACE - share * (variations.length - 1) : share }));
};

// Serializes the draft for the API: strips nulls the schema rejects and drops empty clause values.
export const toPayload = (draft) => ({
	enabled: draft.enabled,
	offVariationId: draft.offVariationId,
	rules: draft.rules.map((rule) => ({
		id: rule.id,
		description: rule.description,
		clauses: rule.clauses.map((clause) => ({ attribute: clause.attribute, operator: clause.operator, values: clause.values, negate: clause.negate })),
		serve: rule.serve.rollout ? { rollout: rule.serve.rollout } : { variationId: rule.serve.variationId },
	})),
	fallthrough: draft.fallthrough.rollout ? { rollout: draft.fallthrough.rollout } : { variationId: draft.fallthrough.variationId },
});

// Local validation that mirrors the backend messages so most mistakes are caught before a request.
export function validateDraft(draft, variations, segmentKeys) {
	const issues = [];
	const ids = new Set(variations.map((variation) => variation.id));
	const checkServe = (label, serve) => {
		if (serve.rollout) {
			const total = serve.rollout.weights.reduce((sum, entry) => sum + entry.weight, 0);
			if (total !== BUCKET_SPACE) issues.push(`${label} rollout weights must add up to 100%.`);
		} else if (!ids.has(serve.variationId)) issues.push(`${label} must serve a variation.`);
	};
	draft.rules.forEach((rule, index) => {
		const label = `Rule ${index + 1}`;
		if (!rule.clauses.length) issues.push(`${label} needs at least one condition.`);
		rule.clauses.forEach((clause, clauseIndex) => {
			if (!clause.attribute.trim()) issues.push(`${label}, condition ${clauseIndex + 1}: choose an attribute.`);
			if (!clause.values.length) issues.push(`${label}, condition ${clauseIndex + 1}: add at least one value.`);
			if (clause.operator === "segmentMatch") {
				for (const key of clause.values) if (!segmentKeys.has(key)) issues.push(`${label} references an unknown segment ${key}.`);
			}
		});
		checkServe(label, rule.serve);
	});
	checkServe("Fallthrough", draft.fallthrough);
	if (!ids.has(draft.offVariationId)) issues.push("Choose an off variation.");
	return issues;
}
