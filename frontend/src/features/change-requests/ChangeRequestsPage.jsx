import { EmptyState } from "../../shared/components/EmptyState.jsx";
import { ErrorBanner } from "../../shared/components/ErrorBanner.jsx";
import { Pagination } from "../../shared/components/Pagination.jsx";
import { SelectMenu } from "../../shared/components/SelectMenu.jsx";
import { Skeleton } from "../../shared/components/Skeleton.jsx";
import { Tabs } from "../../shared/components/Tabs.jsx";
import { useProject } from "../../shared/context/ProjectContext.jsx";
import { useSession } from "../../shared/context/SessionContext.jsx";
import { useAsync } from "../../shared/hooks/useAsync.js";
import { Link } from "../../shared/router/Link.jsx";
import { buildPath } from "../../shared/router/match.js";
import { useRoute } from "../../shared/router/router.js";
import { relativeTime } from "../../shared/utils/date.js";
import { flagApi } from "../flags/flag.api.js";
import { ProfileAvatar } from "../profiles/ProfileAvatar.jsx";
import { changeRequestApi } from "./change-request.api.js";
import { KindBadge, StatusBadge } from "./StatusBadge.jsx";

const STATUS_OPTIONS = [
	{ value: "", label: "Any status" },
	{ value: "pending", label: "Pending review" },
	{ value: "approved", label: "Approved" },
	{ value: "conflicted", label: "Conflicted" },
	{ value: "applied", label: "Applied" },
	{ value: "rejected", label: "Rejected" },
	{ value: "withdrawn", label: "Withdrawn" },
];

export function ChangeRequestsPage() {
	const { project } = useProject();
	const { can } = useSession();
	const { query, setQuery } = useRoute();
	const canReview = can("changeRequest:review");
	const tab = query.tab === "review" && canReview ? "review" : query.tab === "mine" ? "mine" : "all";
	const page = Math.max(1, Number(query.page) || 1);
	const filters = {
		status: query.status || "",
		flagKey: query.flag || "",
		page,
		pageSize: 20,
		...(tab === "review" ? { needsMyReview: "true" } : tab === "mine" ? { mine: "true" } : {}),
	};
	const { data, error, loading, reload } = useAsync(
		() => changeRequestApi.list(project.key, filters),
		[project.key, JSON.stringify(filters)],
	);
	const flags = useAsync(() => flagApi.list(project.key, { pageSize: 100, sort: "key" }), [project.key]);
	const environmentName = (key) => project.environments.find((environment) => environment.key === key)?.name || key;

	const tabs = [
		...(canReview ? [{ value: "review", label: "Needs my review", badge: data?.counts.needsMyReview ?? undefined }] : []),
		{ value: "mine", label: "Mine", badge: data?.counts.mine ?? undefined },
		{ value: "all", label: "All" },
	];

	let body;
	if (loading && !data) body = <Skeleton rows={6} />;
	else if (error) body = <ErrorBanner message={error.message} requestId={error.status >= 500 ? error.requestId : ""} onRetry={reload} />;
	else if (!data.items.length) {
		body = (
			<EmptyState
				description={
					tab === "review"
						? "Nothing is waiting for your review."
						: tab === "mine"
							? "You have not proposed any changes in this project."
							: "Propose a change from a protected environment's targeting editor, or promote into one."
				}
				icon="rate_review"
				title={tab === "review" ? "Your queue is clear" : "No change requests"}
			/>
		);
	} else {
		body = (
			<>
				<div className="table-scroll">
					<table className="data-table change-request-table">
						<thead>
							<tr>
								<th scope="col">Change request</th>
								<th scope="col">Status</th>
								<th scope="col">Flag</th>
								<th scope="col">Author</th>
								<th scope="col">Approvals</th>
								<th scope="col">Age</th>
							</tr>
						</thead>
						<tbody>
							{data.items.map((item) => {
								const approvals = item.reviews.filter((review) => review.decision === "approve").length;
								return (
									<tr key={item._id}>
										<td>
											<div className="flag-cell">
												<Link
													className="flag-name"
													to={buildPath("changeRequest", { projectKey: project.key, id: item._id })}
												>
													{item.title}
												</Link>
												<div className="flag-meta">
													<KindBadge kind={item.kind} />
													<span>{environmentName(item.environment)}</span>
												</div>
											</div>
										</td>
										<td>
											<StatusBadge status={item.status} />
										</td>
										<td>
											<Link
												className="flag-name"
												to={buildPath(
													"flag",
													{ projectKey: project.key, flagKey: item.flagKey },
													{ env: item.environment },
												)}
											>
												{item.flagKey}
											</Link>
										</td>
										<td>
											{item.author ? (
												<span className="owner-cell">
													<ProfileAvatar profile={item.author} size="small" />
													<span>{item.author.name}</span>
												</span>
											) : (
												<span className="muted">Unknown</span>
											)}
										</td>
										<td>
											{approvals}/{item.policy.requiredApprovals}
										</td>
										<td>
											<time dateTime={item.createdAt} title={new Date(item.createdAt).toLocaleString()}>
												{relativeTime(item.createdAt)}
											</time>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
				<Pagination
					onPage={(next) => setQuery({ page: next === 1 ? "" : String(next) })}
					page={data.page}
					pageSize={data.pageSize}
					total={data.total}
				/>
			</>
		);
	}

	return (
		<section className="page" aria-labelledby="change-requests-title">
			<header className="page-header">
				<div>
					<h1 id="change-requests-title">Change requests</h1>
					<p className="page-subtitle">Proposals for protected environments in {project.name}: review, approve, and apply.</p>
				</div>
			</header>
			<Tabs
				ariaLabel="Change request views"
				items={tabs}
				onChange={(next) => setQuery({ tab: next === "all" ? "" : next, page: "" })}
				value={tab}
			/>
			<div className="filter-bar">
				<SelectMenu
					ariaLabel="Status"
					onChange={(status) => setQuery({ status, page: "" })}
					options={STATUS_OPTIONS}
					value={filters.status}
				/>
				<SelectMenu
					ariaLabel="Flag"
					disabled={!flags.data}
					onChange={(flag) => setQuery({ flag, page: "" })}
					options={[
						{ value: "", label: "Any flag" },
						...(flags.data?.items || []).map((flag) => ({ value: flag.key, label: flag.name })),
					]}
					value={filters.flagKey}
				/>
			</div>
			{loading && data && <div className="page-progress" aria-hidden="true" />}
			{body}
		</section>
	);
}
