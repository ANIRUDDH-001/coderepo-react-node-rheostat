import { Link } from "../../shared/router/Link.jsx";
import { buildPath } from "../../shared/router/match.js";
import { relativeTime } from "../../shared/utils/date.js";

export function RolloutCard({ environmentName, projectKey, rollout }) {
	return (
		<li className="rollout-card">
			<div className="rollout-card-heading">
				<Link to={buildPath("rollout", { projectKey, id: rollout.id })}>{rollout.flagKey}</Link>
				<span className={`rollout-status rollout-status-${rollout.status}`}>{rollout.status}</span>
			</div>
			<div className="rollout-card-meter" aria-hidden="true">
				<span style={{ width: `${rollout.currentPercent}%` }} />
			</div>
			<div className="rollout-card-meta">
				<span>
					{environmentName} · {rollout.currentPercent}% of the audience
				</span>
				<span className="muted">
					{rollout.nextStep
						? `Next: ${rollout.nextStep.percent}% ${relativeTime(rollout.nextStep.startAt)}`
						: "All steps applied"}
				</span>
			</div>
		</li>
	);
}
