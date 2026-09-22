import { Badge } from "../../shared/components/Badge.jsx";
import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { Link } from "../../shared/router/Link.jsx";
import { buildPath } from "../../shared/router/match.js";
import { formatDateTime, relativeTime } from "../../shared/utils/date.js";
import { ProfileAvatar } from "../profiles/ProfileAvatar.jsx";

const ENTITY_ICONS = {
	flag: "flag",
	segment: "group",
	changeRequest: "rate_review",
	rollout: "timeline",
	project: "layers",
	person: "person",
	webhook: "webhook",
};

const TONE_BY_ACTION = [
	[/killSwitch\.activated|\.rejected|\.aborted|\.stalled|deliveryDead|autoDisabled/, "danger"],
	[/\.conflicted|\.paused|\.withdrawn/, "warning"],
	[/\.applied|\.approved|\.completed|\.resumed|\.stepApplied|\.restored|killSwitch\.cleared/, "success"],
	[/\.created|\.promoted/, "accent"],
];

const toneFor = (action) => TONE_BY_ACTION.find(([pattern]) => pattern.test(action))?.[1] || "neutral";
const actionLabel = (action) =>
	action
		.split(".")
		.slice(1)
		.join(" ")
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.toLowerCase();

// Where an entry leads. Flags and segments are addressed by key (their label); the rest by id.
export function entityLink(entry, projectKey) {
	if (!projectKey) return null;
	switch (entry.entityType) {
		case "flag":
			return buildPath("flag", { projectKey, flagKey: entry.entityLabel });
		case "segment":
			return buildPath("segment", { projectKey, segmentKey: entry.entityLabel });
		case "changeRequest":
			return buildPath("changeRequest", { projectKey, id: entry.entityId });
		case "rollout":
			return buildPath("rollout", { projectKey, id: entry.entityId });
		case "webhook":
			return buildPath("webhook", { projectKey, id: entry.entityId });
		case "project":
		case "person":
			return buildPath("settings", { projectKey });
		default:
			return null;
	}
}

export function AuditRow({ entry, projectKey }) {
	const link = entityLink(entry, projectKey);
	const automated = entry.actorKind === "system";
	return (
		<li className="audit-row">
			<span className="audit-row-icon" aria-hidden="true">
				<MaterialIcon size={20}>{ENTITY_ICONS[entry.entityType] || "history"}</MaterialIcon>
			</span>
			<div className="audit-row-body">
				<p className="audit-row-summary">{entry.summary}</p>
				<div className="audit-row-meta">
					<Badge tone={toneFor(entry.action)}>{actionLabel(entry.action)}</Badge>
					{link ? <Link to={link}>{entry.entityLabel}</Link> : <span>{entry.entityLabel}</span>}
					{automated ? (
						<Badge icon="smart_toy" tone="info" title="Written by Rheostat on the actor's behalf">
							Automated
						</Badge>
					) : entry.actor ? (
						<span className="audit-row-actor">
							<ProfileAvatar profile={entry.actor} size="small" />
							{entry.actor.name}
						</span>
					) : (
						<span className="muted">Unknown actor</span>
					)}
					<time className="muted" dateTime={entry.at} title={formatDateTime(entry.at)}>
						{relativeTime(entry.at)}
					</time>
				</div>
			</div>
		</li>
	);
}
