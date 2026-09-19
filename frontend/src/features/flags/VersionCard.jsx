import { Badge } from "../../shared/components/Badge.jsx";
import { DiffView } from "../../shared/components/DiffView.jsx";
import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { formatDateTime, relativeTime } from "../../shared/utils/date.js";
import { ProfileAvatar } from "../profiles/ProfileAvatar.jsx";

const SOURCE_LABELS = {
	create: { label: "Created", tone: "neutral" },
	direct: { label: "Direct edit", tone: "accent" },
	changeRequest: { label: "Change request", tone: "info" },
	rollback: { label: "Rollback", tone: "warning" },
	rollout: { label: "Rollout step", tone: "success" },
	promotion: { label: "Promotion", tone: "info" },
};

function Actor({ actor }) {
	if (!actor) return <span className="muted">Unknown actor</span>;
	return (
		<span className="owner-cell">
			<ProfileAvatar profile={actor} size="small" />
			<span>{actor.name}</span>
		</span>
	);
}

export function VersionCard({ current, entry, rollback, variations }) {
	if (entry.kind === "killSwitch") {
		const activated = entry.action === "flag.killSwitch.activated";
		return (
			<li className={`timeline-item timeline-kill ${activated ? "timeline-kill-on" : ""}`}>
				<span className="timeline-marker" aria-hidden="true">
					<MaterialIcon size={16}>bolt</MaterialIcon>
				</span>
				<div className="timeline-body">
					<div className="timeline-head">
						<Badge icon="bolt" tone={activated ? "danger" : "neutral"}>
							Kill switch {activated ? "activated" : "cleared"}
						</Badge>
						<Actor actor={entry.actor} />
						<time dateTime={entry.createdAt} title={formatDateTime(entry.createdAt)}>
							{relativeTime(entry.createdAt)}
						</time>
					</div>
					{entry.reason && <p className="timeline-reason">{entry.reason}</p>}
				</div>
			</li>
		);
	}
	const source = SOURCE_LABELS[entry.source] || { label: entry.source, tone: "neutral" };
	return (
		<li className="timeline-item">
			<span className="timeline-marker" aria-hidden="true">
				v{entry.version}
			</span>
			<div className="timeline-body">
				<div className="timeline-head">
					<strong>Version {entry.version}</strong>
					<Badge tone={source.tone}>{source.label}</Badge>
					{current && <Badge tone="success">Current</Badge>}
					<Actor actor={entry.actor} />
					<time dateTime={entry.createdAt} title={formatDateTime(entry.createdAt)}>
						{relativeTime(entry.createdAt)}
					</time>
				</div>
				{entry.reason && <p className="timeline-reason">{entry.reason}</p>}
				{entry.version > 1 && <DiffView diff={entry.diff} variations={variations} />}
				{!current && rollback && (
					<div className="timeline-actions">
						<button
							className="tonal-button"
							disabled={rollback.disabled}
							title={rollback.title}
							type="button"
							onClick={() => rollback.onClick(entry)}
						>
							<MaterialIcon size={18}>undo</MaterialIcon> {rollback.label}
						</button>
					</div>
				)}
			</div>
		</li>
	);
}
