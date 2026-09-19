import { Badge } from "../../shared/components/Badge.jsx";
import { Link } from "../../shared/router/Link.jsx";
import { buildPath } from "../../shared/router/match.js";
import { formatValue } from "../../shared/utils/format.js";

const TONES = { RULE_MATCH: "accent", FALLTHROUGH: "info", OFF: "neutral", KILL_SWITCH: "danger", ERROR: "warning" };

export function describeReason(reason, flag) {
	if (reason.kind === "KILL_SWITCH") return "Kill switch active";
	if (reason.kind === "OFF") return "Targeting is off";
	if (reason.kind === "ERROR") return reason.message || "Configuration error";
	const bucket = reason.bucket !== undefined ? `, bucket ${reason.bucket.toLocaleString()} → ${(reason.bucket / 1000).toFixed(1)}%` : "";
	if (reason.kind === "RULE_MATCH") {
		const rules = flag?.rules || [];
		const rule = rules.find((candidate) => candidate.id === reason.ruleId);
		const label = rule?.description ? `'${rule.description}'` : "";
		return `Matched rule ${label} (rule ${reason.ruleIndex + 1})${bucket}`;
	}
	return `Fallthrough${reason.bucket !== undefined ? " rollout" : ""}${bucket}`;
}

export function EvaluationResults({ environment, projectKey, results, rulesByFlag = {} }) {
	return (
		<div className="table-scroll">
			<table className="data-table results-table">
				<thead>
					<tr>
						<th scope="col">Flag</th>
						<th scope="col">Value</th>
						<th scope="col">Variation</th>
						<th scope="col">Reason</th>
					</tr>
				</thead>
				<tbody>
					{results.map((result) => (
						<tr key={result.flagKey}>
							<td>
								<Link className="flag-name" to={buildPath("flag", { projectKey, flagKey: result.flagKey }, { env: environment })}>
									{result.name}
								</Link>
								<div className="flag-meta">
									<code>{result.flagKey}</code>
									<span className="muted">{result.type}</span>
								</div>
							</td>
							<td>
								<code className="result-value">{formatValue(result.value)}</code>
							</td>
							<td>{result.variationId ? rulesByFlag[result.flagKey]?.variations?.find((variation) => variation.id === result.variationId)?.name || result.variationId : "—"}</td>
							<td>
								<Badge tone={TONES[result.reason.kind] || "neutral"}>{result.reason.kind.replace("_", " ").toLowerCase()}</Badge>
								<span className="reason-text">{describeReason(result.reason, rulesByFlag[result.flagKey])}</span>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
