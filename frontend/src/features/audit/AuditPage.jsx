import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "../../shared/components/EmptyState.jsx";
import { ErrorBanner } from "../../shared/components/ErrorBanner.jsx";
import { SelectMenu } from "../../shared/components/SelectMenu.jsx";
import { Skeleton } from "../../shared/components/Skeleton.jsx";
import { useProject } from "../../shared/context/ProjectContext.jsx";
import { useAsync } from "../../shared/hooks/useAsync.js";
import { useRoute } from "../../shared/router/router.js";
import { profileApi } from "../profiles/profile.api.js";
import { auditApi } from "./audit.api.js";
import { AuditRow } from "./AuditRow.jsx";

const PAGE_SIZE = 25;
const ENTITY_OPTIONS = [
	{ value: "", label: "All activity" },
	{ value: "flag", label: "Flags" },
	{ value: "segment", label: "Segments" },
	{ value: "changeRequest", label: "Change requests" },
	{ value: "rollout", label: "Rollouts" },
	{ value: "webhook", label: "Webhooks" },
	{ value: "project", label: "Projects" },
	{ value: "person", label: "People" },
];

export function AuditPage() {
	const { project, projects } = useProject();
	const { query, setQuery } = useRoute();
	const scope = query.scope === "all" ? "" : project.key;
	const filters = { projectKey: scope, entityType: query.entityType || "", actorId: query.actorId || "", limit: PAGE_SIZE };
	const people = useAsync(() => profileApi.list(), []);
	const first = useAsync(() => auditApi.list(filters), [scope, filters.entityType, filters.actorId]);
	const [extra, setExtra] = useState({ items: [], nextBefore: undefined, error: null, loading: false });

	// Later pages hang off the first page's cursor; a filter change resets them.
	useEffect(
		() => setExtra({ items: [], nextBefore: undefined, error: null, loading: false }),
		[scope, filters.entityType, filters.actorId],
	);

	const nextBefore = extra.nextBefore === undefined ? first.data?.nextBefore : extra.nextBefore;
	const loadMore = useCallback(async () => {
		if (!nextBefore) return;
		setExtra((previous) => ({ ...previous, loading: true, error: null }));
		try {
			const page = await auditApi.list({ ...filters, before: nextBefore });
			setExtra((previous) => ({
				items: [...previous.items, ...page.items],
				nextBefore: page.nextBefore,
				error: null,
				loading: false,
			}));
		} catch (error) {
			setExtra((previous) => ({ ...previous, loading: false, error }));
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [nextBefore, scope, filters.entityType, filters.actorId]);

	const actorOptions = [
		{ value: "", label: "Everyone" },
		...(people.data || []).map((person) => ({ value: person._id, label: person.name })),
	];
	const scopeOptions = [
		{ value: "", label: `${project.name} only` },
		...(projects.length > 1 ? [{ value: "all", label: "All projects" }] : []),
	];
	const items = [...(first.data?.items || []), ...extra.items];

	return (
		<section className="page audit-page" aria-labelledby="audit-title">
			<header className="page-header">
				<div>
					<h1 id="audit-title">Audit</h1>
					<p className="page-subtitle">Every change, who made it, and when.</p>
				</div>
			</header>
			<div className="page-controls audit-filters">
				<SelectMenu
					ariaLabel="Activity type"
					onChange={(entityType) => setQuery({ entityType })}
					options={ENTITY_OPTIONS}
					value={filters.entityType}
				/>
				<SelectMenu
					ariaLabel="Actor"
					onChange={(actorId) => setQuery({ actorId })}
					options={actorOptions}
					value={filters.actorId}
				/>
				<SelectMenu
					ariaLabel="Project scope"
					onChange={(scopeValue) => setQuery({ scope: scopeValue })}
					options={scopeOptions}
					value={query.scope || ""}
				/>
			</div>
			{first.loading && !first.data ? (
				<Skeleton rows={8} />
			) : first.error && !first.data ? (
				<ErrorBanner message={first.error.message} onRetry={first.reload} />
			) : items.length === 0 ? (
				<EmptyState description="Nothing matches these filters yet." icon="history" title="No activity" />
			) : (
				<>
					<ol className="audit-list">
						{items.map((entry) => (
							<AuditRow
								entry={entry}
								key={entry._id}
								projectKey={
									scope
										? project.key
										: projects.find((candidate) => String(candidate._id) === String(entry.projectId))?.key || ""
								}
							/>
						))}
					</ol>
					{extra.error && <ErrorBanner message={extra.error.message} onRetry={loadMore} />}
					{nextBefore ? (
						<button className="tonal-button audit-load-more" disabled={extra.loading} type="button" onClick={loadMore}>
							{extra.loading ? "Loading…" : "Load more"}
						</button>
					) : (
						<p className="muted audit-end">You have reached the beginning of the history.</p>
					)}
				</>
			)}
		</section>
	);
}
