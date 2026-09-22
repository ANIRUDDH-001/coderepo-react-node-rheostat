import { Badge } from "../../shared/components/Badge.jsx";
import { EmptyState } from "../../shared/components/EmptyState.jsx";
import { ErrorBanner } from "../../shared/components/ErrorBanner.jsx";
import { Skeleton } from "../../shared/components/Skeleton.jsx";
import { useProject } from "../../shared/context/ProjectContext.jsx";
import { useSession } from "../../shared/context/SessionContext.jsx";
import { useAsync } from "../../shared/hooks/useAsync.js";
import { Link } from "../../shared/router/Link.jsx";
import { buildPath } from "../../shared/router/match.js";
import { formatDate, relativeTime } from "../../shared/utils/date.js";
import { StatusBadge } from "../change-requests/StatusBadge.jsx";
import { ActivityChart } from "./ActivityChart.jsx";
import { dashboardApi } from "./dashboard.api.js";
import { DistributionBars } from "./DistributionBars.jsx";
import { RolloutCard } from "./RolloutCard.jsx";
import { StatTile } from "./StatTile.jsx";

const SOURCE_LABELS = {
	create: "Created",
	direct: "Direct edit",
	changeRequest: "Change request",
	rollback: "Rollback",
	rollout: "Rollout step",
	promotion: "Promotion",
};

function Panel({ action = null, children, id, title }) {
	return (
		<section className="dashboard-panel" aria-labelledby={id}>
			<div className="editor-section-header">
				<h3 id={id}>{title}</h3>
				{action}
			</div>
			{children}
		</section>
	);
}

function PanelEmpty({ children }) {
	return <p className="dashboard-empty">{children}</p>;
}

export function DashboardPage() {
	const { project } = useProject();
	const { can } = useSession();
	const { data, error, loading, reload } = useAsync(() => dashboardApi.get(project.key), [project.key]);
	if (loading && !data) return <Skeleton rows={8} />;
	if (error && !data)
		return <ErrorBanner message={error.message} requestId={error.status >= 500 ? error.requestId : ""} onRetry={reload} />;
	const environmentName = (key) => project.environments.find((environment) => environment.key === key)?.name || key;
	const flagsPath = (query) => buildPath("flags", { projectKey: project.key }, query);
	const { flagCounts, evaluations } = data;
	const totalEvaluations = evaluations.days.reduce((sum, day) => sum + day.simulated + day.playground, 0);

	return (
		<section className="page dashboard-page" aria-labelledby="dashboard-title">
			<header className="page-header">
				<div>
					<h1 id="dashboard-title">{project.name}</h1>
					<p className="page-subtitle">{project.description || "Release health at a glance."}</p>
				</div>
			</header>
			<div className="stat-grid">
				<StatTile icon="flag" label="Active flags" to={flagsPath({})} value={flagCounts.active} />
				<StatTile
					icon="timeline"
					label="Active rollouts"
					to={buildPath("rollouts", { projectKey: project.key }, { status: "active" })}
					tone="success"
					value={data.activeRollouts.length}
				/>
				<StatTile
					icon="rate_review"
					label={can("changeRequest:review") ? "Awaiting my review" : "Open proposals of mine"}
					to={buildPath("changeRequests", { projectKey: project.key }, { tab: can("changeRequest:review") ? "review" : "mine" })}
					tone="info"
					value={can("changeRequest:review") ? data.pendingChangeRequests.needsMyReview : data.pendingChangeRequests.mine}
				/>
				<StatTile
					icon="cleaning_services"
					label="Ready to remove"
					to={flagsPath({ stale: "readyToRemove" })}
					tone="warning"
					value={flagCounts.readyToRemove}
				/>
				<StatTile icon="event_busy" label="Overdue" to={flagsPath({ stale: "overdue" })} tone="danger" value={flagCounts.overdue} />
				<StatTile icon="bolt" label="Kill switches" tone="danger" value={flagCounts.killSwitched} />
			</div>

			<div className="dashboard-columns">
				<Panel id="dashboard-activity" title={`Evaluations · last 14 days (${totalEvaluations})`}>
					{totalEvaluations === 0 ? (
						<PanelEmpty>No evaluations yet. Run the playground to see activity here.</PanelEmpty>
					) : (
						<ActivityChart days={evaluations.days} />
					)}
				</Panel>
				<Panel id="dashboard-distribution" title="Variations served in production">
					{evaluations.byFlag.length === 0 ? (
						<PanelEmpty>Distributions appear once flags have been evaluated.</PanelEmpty>
					) : (
						<DistributionBars byFlag={evaluations.byFlag} projectKey={project.key} />
					)}
				</Panel>
			</div>

			<div className="dashboard-columns">
				<Panel
					action={<Link to={buildPath("rollouts", { projectKey: project.key })}>All rollouts</Link>}
					id="dashboard-rollouts"
					title="Active rollouts"
				>
					{data.activeRollouts.length === 0 ? (
						<PanelEmpty>No rollout is in progress. Plan one from a flag's environment tab.</PanelEmpty>
					) : (
						<ul className="dashboard-list">
							{data.activeRollouts.map((rollout) => (
								<RolloutCard
									environmentName={environmentName(rollout.environment)}
									key={rollout.id}
									projectKey={project.key}
									rollout={rollout}
								/>
							))}
						</ul>
					)}
				</Panel>
				<Panel
					action={<Link to={buildPath("changeRequests", { projectKey: project.key }, { tab: "review" })}>Review queue</Link>}
					id="dashboard-approvals"
					title="Pending approvals"
				>
					{data.pendingChangeRequests.items.length === 0 ? (
						<PanelEmpty>
							{can("changeRequest:review") ? "Nothing is waiting for your review." : "Reviewers see their queue here."}
						</PanelEmpty>
					) : (
						<ul className="dashboard-list">
							{data.pendingChangeRequests.items.map((item) => (
								<li className="dashboard-row" key={item._id}>
									<div className="dashboard-row-main">
										<Link to={buildPath("changeRequest", { projectKey: project.key, id: item._id })}>{item.title}</Link>
										<span className="muted">
											{item.flagKey} · {environmentName(item.environment)} · {relativeTime(item.createdAt)}
										</span>
									</div>
									<StatusBadge status={item.status} />
								</li>
							))}
						</ul>
					)}
				</Panel>
			</div>

			<div className="dashboard-columns">
				<Panel id="dashboard-recent" title="Recent production changes">
					{data.recentProductionChanges.length === 0 ? (
						<PanelEmpty>No production configuration has changed yet.</PanelEmpty>
					) : (
						<ul className="dashboard-list">
							{data.recentProductionChanges.map((version) => (
								<li className="dashboard-row" key={version._id}>
									<div className="dashboard-row-main">
										<Link
											to={buildPath(
												"flag",
												{ projectKey: project.key, flagKey: version.flagKey },
												{ env: "production", tab: "history" },
											)}
										>
											{version.flagKey} · v{version.version}
										</Link>
										<span className="muted">
											{version.reason || SOURCE_LABELS[version.source] || version.source} ·{" "}
											{version.actor?.name || "Unknown"} · {relativeTime(version.createdAt)}
										</span>
									</div>
									<Badge tone="neutral">{SOURCE_LABELS[version.source] || version.source}</Badge>
								</li>
							))}
						</ul>
					)}
				</Panel>
				<div className="dashboard-stack">
					<Panel id="dashboard-stale" title="Flags to clean up">
						{data.staleFlags.length === 0 ? (
							<PanelEmpty>Every temporary flag is within its lifecycle.</PanelEmpty>
						) : (
							<ul className="dashboard-list">
								{data.staleFlags.map((flag) => (
									<li className="dashboard-row" key={flag.flagKey}>
										<div className="dashboard-row-main">
											<Link to={buildPath("flag", { projectKey: project.key, flagKey: flag.flagKey })}>
												{flag.flagKey}
											</Link>
											<span className="muted">
												{flag.overdue && flag.removeBy
													? `Remove-by date passed on ${formatDate(flag.removeBy)}`
													: `Unchanged since ${formatDate(flag.lastEffectiveChangeAt)}`}
											</span>
										</div>
										{flag.overdue ? (
											<Badge icon="event_busy" tone="danger">
												Overdue
											</Badge>
										) : (
											<Badge icon="cleaning_services" tone="warning">
												Ready to remove
											</Badge>
										)}
									</li>
								))}
							</ul>
						)}
					</Panel>
					<Panel id="dashboard-kill" title="Kill switches">
						{data.killSwitches.length === 0 ? (
							<PanelEmpty>No kill switch is active.</PanelEmpty>
						) : (
							<ul className="dashboard-list">
								{data.killSwitches.map((entry) => (
									<li className="dashboard-row" key={entry.flagKey}>
										<div className="dashboard-row-main">
											<Link to={buildPath("flag", { projectKey: project.key, flagKey: entry.flagKey })}>
												{entry.flagKey}
											</Link>
											<span className="muted">
												{entry.reason} · {entry.actor?.name || "Unknown"} · {relativeTime(entry.activatedAt)}
											</span>
										</div>
										<Badge icon="bolt" tone="danger">
											Active
										</Badge>
									</li>
								))}
							</ul>
						)}
					</Panel>
				</div>
			</div>
			{flagCounts.total === 0 && (
				<EmptyState description="Create the first flag to start tracking releases here." icon="flag" title="No flags yet" />
			)}
		</section>
	);
}
