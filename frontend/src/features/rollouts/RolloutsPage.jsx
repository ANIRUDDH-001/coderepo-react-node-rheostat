import { EmptyState } from "../../shared/components/EmptyState.jsx";
import { ErrorBanner } from "../../shared/components/ErrorBanner.jsx";
import { Pagination } from "../../shared/components/Pagination.jsx";
import { SelectMenu } from "../../shared/components/SelectMenu.jsx";
import { Skeleton } from "../../shared/components/Skeleton.jsx";
import { useProject } from "../../shared/context/ProjectContext.jsx";
import { useAsync } from "../../shared/hooks/useAsync.js";
import { Link } from "../../shared/router/Link.jsx";
import { buildPath } from "../../shared/router/match.js";
import { useRoute } from "../../shared/router/router.js";
import { relativeTime } from "../../shared/utils/date.js";
import { rolloutApi } from "./rollout.api.js";

const STATUS_OPTIONS = [
	{ value: "", label: "All statuses" },
	{ value: "active", label: "Active" },
	{ value: "scheduled", label: "Scheduled" },
	{ value: "running", label: "Running" },
	{ value: "paused", label: "Paused" },
	{ value: "stalled", label: "Stalled" },
	{ value: "completed", label: "Completed" },
	{ value: "aborted", label: "Aborted" },
];

export function RolloutsPage() {
	const { project } = useProject();
	const { query, setQuery } = useRoute();
	const page = Math.max(1, Number(query.page) || 1);
	const filters = { status: query.status || "", page, pageSize: 20 };
	const { data, error, loading, reload } = useAsync(() => rolloutApi.list(project.key, filters), [project.key, query.status, page]);
	if (loading && !data) return <Skeleton rows={6} />;
	if (error && !data) return <ErrorBanner message={error.message} onRetry={reload} />;
	return (
		<section className="page rollouts-page" aria-labelledby="rollouts-title">
			<header className="page-header">
				<div><h1 id="rollouts-title">Rollouts</h1><p className="page-subtitle">Schedule and supervise progressive delivery across {project.name}.</p></div>
				<span className="rollout-active-count">{data.counts.active} active</span>
			</header>
			<div className="page-controls">
				<SelectMenu ariaLabel="Rollout status" onChange={(status) => setQuery({ status, page: "" })} options={STATUS_OPTIONS} value={filters.status} />
			</div>
			{!data.items.length ? (
				<EmptyState description="Plan a rollout from a flag’s environment tab to begin progressive delivery." icon="timeline" title="No rollouts found" />
			) : (
				<div className="table-wrap">
					<table className="data-table rollout-table"><thead><tr><th>Flag</th><th>Environment</th><th>Progress</th><th>Status</th><th>Next step</th><th>Created</th></tr></thead>
						<tbody>{data.items.map((plan) => (
							<tr key={plan._id}><td><Link to={buildPath("rollout", { projectKey: project.key, id: plan._id })}>{plan.flagKey}</Link></td><td>{project.environments.find((environment) => environment.key === plan.environment)?.name || plan.environment}</td><td>{plan.currentPercent}%</td><td><span className={`rollout-status rollout-status-${plan.status}`}>{plan.status}</span></td><td>{plan.nextStep ? `${plan.nextStep.percent}% ${relativeTime(plan.nextStep.startAt)}` : "Complete"}</td><td>{relativeTime(plan.createdAt)}</td></tr>
						))}</tbody></table>
				</div>
			)}
			<Pagination onPage={(next) => setQuery({ page: next === 1 ? "" : next })} page={data.page} pageSize={data.pageSize} total={data.total} />
		</section>
	);
}
