import { Badge } from "../../shared/components/Badge.jsx";

// One pill per environment on the flags table: off, on (fixed), or a rollout split, plus the rule count.
export function EnvironmentStatePill({ environment, summary }) {
	const fallthrough = summary.fallthrough;
	let tone = "neutral";
	let text = "Off";
	if (summary.enabled) {
		tone = fallthrough.kind === "rollout" ? "info" : "success";
		text = fallthrough.kind === "rollout" ? fallthrough.label : `On · ${fallthrough.label}`;
	}
	const rules = summary.ruleCount ? ` · ${summary.ruleCount} rule${summary.ruleCount === 1 ? "" : "s"}` : "";
	return (
		<Badge className="env-pill" title={`${environment.name}: ${text}${rules} (v${summary.version})`} tone={tone}>
			<span className="env-pill-key" style={{ "--env-color": environment.color }} />
			<span className="env-pill-text">
				{text}
				{rules}
			</span>
		</Badge>
	);
}
