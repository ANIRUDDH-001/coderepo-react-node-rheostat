// Deterministic structural diff of environment configurations. Shared by change requests, history, promotion, and rollouts.

const normalizeClause = (clause) => ({
	attribute: clause.attribute,
	operator: clause.operator,
	values: [...(clause.values || [])].map(String),
	negate: Boolean(clause.negate),
});

export const normalizeServe = (serve) =>
	serve?.rollout
		? {
				rollout: {
					bucketBy: serve.rollout.bucketBy || "key",
					weights: (serve.rollout.weights || []).map((entry) => ({ variationId: entry.variationId, weight: entry.weight })),
				},
			}
		: { variationId: serve?.variationId ?? null };

export const normalizeRule = (rule) => ({
	id: rule.id,
	description: rule.description || "",
	clauses: (rule.clauses || []).map(normalizeClause),
	serve: normalizeServe(rule.serve),
});

export function normalizeConfig(config) {
	return {
		enabled: Boolean(config?.enabled),
		offVariationId: config?.offVariationId ?? null,
		rules: (config?.rules || []).map(normalizeRule),
		fallthrough: normalizeServe(config?.fallthrough),
	};
}

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const changed = (path, before, after) => ({ path, kind: "changed", before, after });

function diffRule(path, before, after, entries) {
	if (before.description !== after.description) entries.push(changed(`${path}.description`, before.description, after.description));
	const count = Math.max(before.clauses.length, after.clauses.length);
	for (let index = 0; index < count; index += 1) {
		const left = before.clauses[index];
		const right = after.clauses[index];
		if (!left) entries.push({ path: `${path}.clauses.${index}`, kind: "added", before: null, after: right });
		else if (!right) entries.push({ path: `${path}.clauses.${index}`, kind: "removed", before: left, after: null });
		else {
			for (const field of ["attribute", "operator", "values", "negate"]) {
				if (!same(left[field], right[field])) entries.push(changed(`${path}.clauses.${index}.${field}`, left[field], right[field]));
			}
		}
	}
	if (!same(before.serve, after.serve)) entries.push(changed(`${path}.serve`, before.serve, after.serve));
}

export function diffEnvConfig(beforeConfig, afterConfig) {
	const before = normalizeConfig(beforeConfig);
	const after = normalizeConfig(afterConfig);
	const entries = [];
	if (before.enabled !== after.enabled) entries.push(changed("enabled", before.enabled, after.enabled));
	if (before.offVariationId !== after.offVariationId)
		entries.push(changed("offVariationId", before.offVariationId, after.offVariationId));
	const beforeById = new Map(before.rules.map((rule) => [rule.id, rule]));
	const afterById = new Map(after.rules.map((rule) => [rule.id, rule]));
	for (const rule of before.rules) {
		if (!afterById.has(rule.id)) entries.push({ path: `rules.${rule.id}`, kind: "removed", before: rule, after: null });
		else diffRule(`rules.${rule.id}`, rule, afterById.get(rule.id), entries);
	}
	for (const rule of after.rules)
		if (!beforeById.has(rule.id)) entries.push({ path: `rules.${rule.id}`, kind: "added", before: null, after: rule });
	const beforeOrder = before.rules.map((rule) => rule.id).filter((id) => afterById.has(id));
	const afterOrder = after.rules.map((rule) => rule.id).filter((id) => beforeById.has(id));
	if (!same(beforeOrder, afterOrder)) entries.push(changed("rules.order", beforeOrder, afterOrder));
	if (!same(before.fallthrough, after.fallthrough)) entries.push(changed("fallthrough", before.fallthrough, after.fallthrough));
	return entries;
}

export const isEquivalent = (left, right) => diffEnvConfig(left, right).length === 0;
