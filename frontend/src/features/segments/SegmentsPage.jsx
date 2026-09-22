import { useState } from "react";
import { ConfirmationDialog } from "../../shared/components/ConfirmationDialog.jsx";
import { EmptyState } from "../../shared/components/EmptyState.jsx";
import { ErrorBanner } from "../../shared/components/ErrorBanner.jsx";
import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { Skeleton } from "../../shared/components/Skeleton.jsx";
import { useToast } from "../../shared/components/Toast.jsx";
import { useProject } from "../../shared/context/ProjectContext.jsx";
import { useSession } from "../../shared/context/SessionContext.jsx";
import { useAsync } from "../../shared/hooks/useAsync.js";
import { Link } from "../../shared/router/Link.jsx";
import { buildPath } from "../../shared/router/match.js";
import { navigate } from "../../shared/router/router.js";
import { relativeTime } from "../../shared/utils/date.js";
import { pluralize } from "../../shared/utils/format.js";
import { segmentApi } from "./segment.api.js";

export function UsageList({ projectKey, references }) {
	if (!references.length) return <span className="muted">Not used yet</span>;
	return (
		<ul className="usage-list">
			{references.map((reference) => (
				<li key={reference.key}>
					<Link to={buildPath("flag", { projectKey, flagKey: reference.key })}>{reference.name}</Link>
					<span className="muted"> · {reference.environments.join(", ")}</span>
					{reference.archived && <span className="muted"> · archived</span>}
				</li>
			))}
		</ul>
	);
}

export function SegmentsPage() {
	const { project } = useProject();
	const { can } = useSession();
	const { notify } = useToast();
	const { data, error, loading, reload } = useAsync(() => segmentApi.list(project.key), [project.key], {
		key: `segments:${project.key}`,
	});
	const [deleting, setDeleting] = useState(null);
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState(null);
	const canManage = can("segment:manage");

	const remove = async () => {
		setBusy(true);
		setFailure(null);
		try {
			await segmentApi.remove(project.key, deleting.key);
			notify({ kind: "success", message: `Segment ${deleting.key} deleted.` });
			setDeleting(null);
			reload();
		} catch (caught) {
			setFailure(caught);
		} finally {
			setBusy(false);
		}
	};

	let body;
	if (loading && !data) body = <Skeleton rows={6} />;
	else if (error) body = <ErrorBanner message={error.message} requestId={error.status >= 500 ? error.requestId : ""} onRetry={reload} />;
	else if (!data.length) {
		body = (
			<EmptyState
				action={
					canManage
						? { label: "Create segment", onClick: () => navigate(buildPath("segmentNew", { projectKey: project.key })) }
						: null
				}
				description="Segments are reusable audiences that targeting rules can reference in any environment."
				icon="group"
				title="No segments yet"
			/>
		);
	} else {
		body = (
			<div className="table-scroll">
				<table className="data-table segment-table">
					<thead>
						<tr>
							<th scope="col">Segment</th>
							<th scope="col">Rules</th>
							<th scope="col">Used by</th>
							<th scope="col">Updated</th>
							{canManage && (
								<th scope="col">
									<span className="sr-only">Actions</span>
								</th>
							)}
						</tr>
					</thead>
					<tbody>
						{data.map((segment) => (
							<tr key={segment._id}>
								<td>
									<div className="flag-cell">
										<Link
											className="flag-name"
											to={buildPath("segment", { projectKey: project.key, segmentKey: segment.key })}
										>
											{segment.name}
										</Link>
										<div className="flag-meta">
											<code>{segment.key}</code>
										</div>
										{segment.description && <p className="muted segment-description">{segment.description}</p>}
									</div>
								</td>
								<td>
									{pluralize(segment.rules.length, "rule")}
									{segment.includedKeys.length > 0 && (
										<span className="muted"> · {segment.includedKeys.length} included</span>
									)}
									{segment.excludedKeys.length > 0 && (
										<span className="muted"> · {segment.excludedKeys.length} excluded</span>
									)}
								</td>
								<td>
									{segment.referencedBy.length ? (
										<details className="usage-details">
											<summary>{pluralize(segment.referencedBy.length, "flag")}</summary>
											<UsageList projectKey={project.key} references={segment.referencedBy} />
										</details>
									) : (
										<span className="muted">Not used</span>
									)}
								</td>
								<td>
									<time dateTime={segment.updatedAt}>{relativeTime(segment.updatedAt)}</time>
								</td>
								{canManage && (
									<td className="row-actions">
										<button
											aria-label={`Delete ${segment.name}`}
											className="icon-button"
											type="button"
											onClick={() => setDeleting(segment)}
										>
											<MaterialIcon>delete</MaterialIcon>
										</button>
									</td>
								)}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		);
	}

	return (
		<section className="page" aria-labelledby="segments-title">
			<header className="page-header">
				<div>
					<h1 id="segments-title">Segments</h1>
					<p className="page-subtitle">
						Reusable audiences for {project.name}. Rules use the same conditions as flags; segments cannot nest.
					</p>
				</div>
				{canManage && (
					<button
						className="primary-button"
						type="button"
						onClick={() => navigate(buildPath("segmentNew", { projectKey: project.key }))}
					>
						<MaterialIcon size={18}>add</MaterialIcon> Create segment
					</button>
				)}
			</header>
			{body}
			{deleting && (
				<ConfirmationDialog
					busy={busy}
					confirmLabel="Delete"
					error={failure && failure.code !== "SEGMENT_IN_USE" ? failure.message : ""}
					message={
						failure?.code === "SEGMENT_IN_USE"
							? `Used by ${pluralize(failure.details?.referencingFlags ?? deleting.referencedBy.length, "flag")}. Remove those rules first.`
							: deleting.referencedBy.length
								? `This segment is used by ${pluralize(deleting.referencedBy.length, "flag")}; the delete will be refused until those rules are removed.`
								: "Targeting rules can no longer reference this segment."
					}
					onCancel={() => {
						setDeleting(null);
						setFailure(null);
					}}
					onConfirm={remove}
					title={`Delete ${deleting.name}?`}
				>
					{deleting.referencedBy.length > 0 && <UsageList projectKey={project.key} references={deleting.referencedBy} />}
				</ConfirmationDialog>
			)}
		</section>
	);
}
