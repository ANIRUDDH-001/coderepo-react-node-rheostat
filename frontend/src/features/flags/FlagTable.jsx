import { Badge } from "../../shared/components/Badge.jsx";
import { Link } from "../../shared/router/Link.jsx";
import { buildPath } from "../../shared/router/match.js";
import { relativeTime } from "../../shared/utils/date.js";
import { ProfileAvatar } from "../profiles/ProfileAvatar.jsx";
import { EnvironmentStatePill } from "./EnvironmentStatePill.jsx";

export function StaleBadges({ flag }) {
	return (
		<>
			{flag.stale?.overdue && (
				<Badge icon="priority_high" title={`Remove-by date passed`} tone="danger">
					Overdue
				</Badge>
			)}
			{flag.stale?.readyToRemove && !flag.stale?.overdue && (
				<Badge icon="hourglass_empty" title="Fully rolled out and untouched for 14+ days" tone="warning">
					Ready to remove
				</Badge>
			)}
			{flag.killSwitch?.active && (
				<Badge icon="bolt" title={flag.killSwitch.reason} tone="danger">
					Kill switch
				</Badge>
			)}
			{flag.archived && (
				<Badge icon="archive" tone="neutral">
					Archived
				</Badge>
			)}
		</>
	);
}

export function FlagTable({ environments, flags, projectKey }) {
	return (
		<div className="table-scroll">
			<table className="data-table flag-table">
				<thead>
					<tr>
						<th scope="col">Flag</th>
						<th scope="col">Type</th>
						<th scope="col">Owner</th>
						{environments.map((environment) => (
							<th key={environment.key} scope="col">
								{environment.name}
							</th>
						))}
						<th scope="col">Updated</th>
					</tr>
				</thead>
				<tbody>
					{flags.map((flag) => (
						<tr key={flag._id}>
							<td>
								<div className="flag-cell">
									<Link className="flag-name" to={buildPath("flag", { projectKey, flagKey: flag.key })}>
										{flag.name}
									</Link>
									<div className="flag-meta">
										<code>{flag.key}</code>
										{flag.tags.map((tag) => (
											<span className="tag" key={tag}>
												{tag}
											</span>
										))}
									</div>
									<div className="flag-badges">
										<StaleBadges flag={flag} />
									</div>
								</div>
							</td>
							<td>
								<Badge tone="neutral">{flag.type}</Badge>
							</td>
							<td>
								{flag.owner ? (
									<span className="owner-cell" title={flag.owner.name}>
										<ProfileAvatar profile={flag.owner} size="small" />
										<span>{flag.owner.name}</span>
									</span>
								) : (
									<span className="muted">Unassigned</span>
								)}
							</td>
							{environments.map((environment) => (
								<td key={environment.key}>
									<EnvironmentStatePill environment={environment} summary={flag.environmentSummaries[environment.key]} />
								</td>
							))}
							<td>
								<time dateTime={flag.updatedAt} title={new Date(flag.updatedAt).toLocaleString()}>
									{relativeTime(flag.updatedAt)}
								</time>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
