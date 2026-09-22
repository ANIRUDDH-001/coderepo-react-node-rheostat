import { formatDateTime, relativeTime } from "../../shared/utils/date.js";

const COLORS = { pending: "var(--muted)", applying: "var(--warning)", applied: "var(--success)", skipped: "var(--outline)" };

function position(date, start, end) {
	if (end <= start) return 50;
	return 8 + ((new Date(date).getTime() - start) / (end - start)) * 84;
}

export function RolloutTimeline({ plan }) {
	const timestamps = plan.steps.map((step) => new Date(step.startAt).getTime());
	const now = Date.now();
	const start = Math.min(...timestamps, now);
	const end = Math.max(...timestamps, now, start + 60 * 60 * 1000);
	const nowPosition = position(now, start, end);
	return (
		<section className="rollout-timeline" aria-labelledby="rollout-timeline-title">
			<div className="editor-section-header">
				<h3 id="rollout-timeline-title">Schedule</h3>
				<span className="muted">Current audience: {plan.currentPercent}%</span>
			</div>
			<svg aria-labelledby="rollout-timeline-svg-title rollout-timeline-description" role="img" viewBox="0 0 720 106">
				<title id="rollout-timeline-svg-title">Rollout schedule</title>
				<desc id="rollout-timeline-description">A timeline of rollout steps and their current status.</desc>
				<line className="rollout-axis" x1="56" x2="664" y1="54" y2="54" />
				<line className="rollout-now" x1={`${nowPosition}%`} x2={`${nowPosition}%`} y1="18" y2="90" />
				<text className="rollout-now-label" x={`${nowPosition}%`} y="14" textAnchor="middle">
					now
				</text>
				{plan.steps.map((step) => {
					const x = position(step.startAt, start, end);
					return (
						<g key={step.id}>
							<circle cx={`${x}%`} cy="54" fill={COLORS[step.status] || "var(--muted)"} r="8" />
							<text className="rollout-step-label" x={`${x}%`} y="78" textAnchor="middle">
								{step.percent}%
							</text>
						</g>
					);
				})}
			</svg>
			<ol className="rollout-step-summary">
				{plan.steps.map((step) => (
					<li key={step.id}>
						<strong>{step.percent}%</strong>{" "}
						<span className={`rollout-status rollout-status-${step.status}`}>{step.status}</span>
						<time dateTime={step.startAt}>
							{formatDateTime(step.startAt)} ({relativeTime(step.startAt)})
						</time>
					</li>
				))}
			</ol>
			{plan.heldByKillSwitch && (
				<p className="rollout-notice" role="status">
					Pending steps are held by the active kill switch.
				</p>
			)}
			{plan.status === "stalled" && (
				<p className="rollout-notice rollout-stalled" role="alert">
					This rollout is stalled because targeting changed outside the plan.
				</p>
			)}
		</section>
	);
}
