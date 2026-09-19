import { useState } from "react";
import { Badge } from "../../shared/components/Badge.jsx";
import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { useToast } from "../../shared/components/Toast.jsx";
import { Link } from "../../shared/router/Link.jsx";
import { buildPath } from "../../shared/router/match.js";
import { formatDate, relativeTime } from "../../shared/utils/date.js";
import { ProfileAvatar } from "../profiles/ProfileAvatar.jsx";
import { StaleBadges } from "./FlagTable.jsx";

export function FlagHeader({ actions, flag, projectKey }) {
	const { notify } = useToast();
	const [copied, setCopied] = useState(false);
	const copyKey = async () => {
		try {
			await navigator.clipboard.writeText(flag.key);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1500);
		} catch {
			notify({ kind: "error", message: "Copying is not available in this browser." });
		}
	};
	return (
		<header className="flag-header">
			<nav aria-label="Breadcrumb" className="breadcrumb">
				<Link to={buildPath("flags", { projectKey })}>Flags</Link>
				<MaterialIcon size={16}>chevron_right</MaterialIcon>
				<span aria-current="page">{flag.name}</span>
			</nav>
			<div className="flag-header-row">
				<div className="flag-title">
					<h1>{flag.name}</h1>
					<div className="flag-meta">
						<code>{flag.key}</code>
						<button aria-label={copied ? "Copied" : "Copy flag key"} className="icon-button icon-button-small" type="button" onClick={copyKey}>
							<MaterialIcon size={16}>{copied ? "check" : "content_copy"}</MaterialIcon>
						</button>
						<Badge tone="neutral">{flag.type}</Badge>
						{flag.tags.map((tag) => (
							<span className="tag" key={tag}>
								{tag}
							</span>
						))}
					</div>
					{flag.description && <p className="flag-description">{flag.description}</p>}
					<div className="flag-facts">
						<span className="flag-fact">
							{flag.owner ? (
								<>
									<ProfileAvatar profile={flag.owner} size="small" />
									<span>{flag.owner.name}</span>
								</>
							) : (
								<span className="muted">No owner</span>
							)}
						</span>
						<span className="flag-fact">
							<MaterialIcon size={16}>{flag.lifecycle.kind === "permanent" ? "lock" : "schedule"}</MaterialIcon>
							<span>
								{flag.lifecycle.kind === "permanent" ? "Permanent" : flag.lifecycle.removeBy ? `Temporary · remove by ${formatDate(flag.lifecycle.removeBy)}` : "Temporary"}
							</span>
						</span>
						{flag.stale?.lastEffectiveChangeAt && (
							<span className="flag-fact muted">
								<MaterialIcon size={16}>history</MaterialIcon>
								<span>Last effective change {relativeTime(flag.stale.lastEffectiveChangeAt)}</span>
							</span>
						)}
						<StaleBadges flag={{ ...flag, killSwitch: { active: false } }} />
					</div>
				</div>
				<div className="flag-header-actions">{actions}</div>
			</div>
		</header>
	);
}
