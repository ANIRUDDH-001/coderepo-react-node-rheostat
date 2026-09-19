import { useState } from "react";
import { EmptyState } from "../../shared/components/EmptyState.jsx";
import { ErrorBanner } from "../../shared/components/ErrorBanner.jsx";
import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { Pagination } from "../../shared/components/Pagination.jsx";
import { Skeleton } from "../../shared/components/Skeleton.jsx";
import { useToast } from "../../shared/components/Toast.jsx";
import { useProject } from "../../shared/context/ProjectContext.jsx";
import { useSession } from "../../shared/context/SessionContext.jsx";
import { useAsync } from "../../shared/hooks/useAsync.js";
import { buildPath } from "../../shared/router/match.js";
import { navigate, useRoute } from "../../shared/router/router.js";
import { flagApi } from "./flag.api.js";
import { FlagCreateDialog } from "./FlagCreateDialog.jsx";
import { DEFAULT_FILTERS, FlagFilters } from "./FlagFilters.jsx";
import { FlagTable } from "./FlagTable.jsx";

const PAGE_SIZE = 25;

// Filters live in the URL so a filtered view can be shared and survives refresh.
const readFilters = (query) => ({
	...DEFAULT_FILTERS,
	...Object.fromEntries(Object.entries(query).filter(([key]) => key in DEFAULT_FILTERS || key === "page" || key === "pageSize")),
});

export function FlagsPage() {
	const { project } = useProject();
	const { can } = useSession();
	const { query, setQuery } = useRoute();
	const { notify } = useToast();
	const [creating, setCreating] = useState(false);
	const filters = readFilters(query);
	const page = Math.max(1, Number(filters.page) || 1);
	const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize) || PAGE_SIZE));
	const requestFilters = {
		query: filters.query,
		type: filters.type,
		stale: filters.stale,
		environment: filters.environment,
		state: filters.environment ? filters.state : "",
		sort: filters.sort,
		archived: filters.archived === "true" ? "true" : "",
		tags: filters.tags,
		page,
		pageSize,
	};
	const { data, error, loading, reload } = useAsync(
		() => flagApi.list(project.key, requestFilters),
		[project.key, JSON.stringify(requestFilters)],
	);

	const filtered = Object.entries(filters).some(([key, value]) => key in DEFAULT_FILTERS && value !== DEFAULT_FILTERS[key]);
	let body;
	if (loading && !data) body = <Skeleton rows={8} />;
	else if (error) body = <ErrorBanner message={error.message} onRetry={reload} />;
	else if (!data.items.length) {
		body = (
			<EmptyState
				action={
					filtered
						? { label: "Clear filters", onClick: () => setQuery({ ...DEFAULT_FILTERS, page: "", pageSize: "" }) }
						: can("flag:create")
							? { label: "Create flag", onClick: () => setCreating(true) }
							: null
				}
				description={filtered ? "No flags match these filters." : "Create the first flag for this project to start targeting."}
				icon="flag"
				title={filtered ? "Nothing matches" : "No flags yet"}
			/>
		);
	} else {
		body = (
			<>
				<FlagTable environments={project.environments} flags={data.items} projectKey={project.key} />
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
		<section className="page" aria-labelledby="flags-title">
			<header className="page-header">
				<div>
					<h1 id="flags-title">Flags</h1>
					<p className="page-subtitle">
						{data ? `${data.total} flag${data.total === 1 ? "" : "s"} in ${project.name}` : project.name}
					</p>
				</div>
				{can("flag:create") && (
					<button className="primary-button" type="button" onClick={() => setCreating(true)}>
						<MaterialIcon size={18}>add</MaterialIcon> Create flag
					</button>
				)}
			</header>
			<FlagFilters environments={project.environments} filters={filters} onChange={(patch) => setQuery(patch)} />
			{loading && data && <div className="page-progress" aria-hidden="true" />}
			{body}
			{creating && (
				<FlagCreateDialog
					onClose={() => setCreating(false)}
					onCreated={(flag) => {
						setCreating(false);
						notify({ kind: "success", message: `Flag ${flag.key} created.` });
						navigate(buildPath("flag", { projectKey: project.key, flagKey: flag.key }));
					}}
					projectKey={project.key}
				/>
			)}
		</section>
	);
}
