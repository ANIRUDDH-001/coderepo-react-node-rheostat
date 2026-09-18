import { AppError } from "../../shared/errors/app-error.js";
import { BUCKET_SPACE } from "../../shared/utils/hash.js";

export const MAX_RULES = 25;

function serveIssues(label, serve, variationIds, issues) {
	if (serve?.variationId !== undefined) {
		if (!variationIds.has(serve.variationId)) issues.push(`${label} serves unknown variation ${serve.variationId}.`);
		return;
	}
	const weights = serve?.rollout?.weights || [];
	const total = weights.reduce((sum, entry) => sum + entry.weight, 0);
	if (total !== BUCKET_SPACE) issues.push(`${label} rollout weights must sum to ${BUCKET_SPACE}; they sum to ${total}.`);
	const seen = new Set();
	for (const entry of weights) {
		if (!variationIds.has(entry.variationId)) issues.push(`${label} rollout serves unknown variation ${entry.variationId}.`);
		if (seen.has(entry.variationId)) issues.push(`${label} rollout lists variation ${entry.variationId} more than once.`);
		seen.add(entry.variationId);
	}
}

// Semantic validation that Zod cannot express: references must exist and splits must be complete.
export function validateEnvConfig(config, flag, segmentKeys = new Set()) {
	const issues = [];
	const variationIds = new Set(flag.variations.map((variation) => variation.id));
	if (!variationIds.has(config.offVariationId)) issues.push(`The off variation ${config.offVariationId} does not exist.`);
	const rules = config.rules || [];
	if (rules.length > MAX_RULES) issues.push(`A configuration may have at most ${MAX_RULES} rules.`);
	const ruleIds = new Set();
	rules.forEach((rule, index) => {
		const label = `Rule ${index + 1}`;
		if (rule.id) {
			if (ruleIds.has(rule.id)) issues.push(`${label} reuses rule id ${rule.id}.`);
			ruleIds.add(rule.id);
		}
		for (const clause of rule.clauses || []) {
			if (clause.operator === "segmentMatch") {
				for (const key of clause.values || []) if (!segmentKeys.has(key)) issues.push(`${label} references unknown segment ${key}.`);
			}
		}
		serveIssues(label, rule.serve, variationIds, issues);
	});
	serveIssues("Fallthrough", config.fallthrough, variationIds, issues);
	if (issues.length) throw new AppError(422, "INVALID_CONFIG", "The configuration is not valid.", { issues });
}
