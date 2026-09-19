import { useState } from "react";
import { ConfirmationDialog } from "../../shared/components/ConfirmationDialog.jsx";
import { DiffView } from "../../shared/components/DiffView.jsx";
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
import { formatDateTime, relativeTime } from "../../shared/utils/date.js";
import { RolloutActiveDialog } from "../flags/RolloutActiveDialog.jsx";
import { ProfileAvatar } from "../profiles/ProfileAvatar.jsx";
import { changeRequestApi } from "./change-request.api.js";
import { CommentThread } from "./CommentThread.jsx";
import { ReviewPanel } from "./ReviewPanel.jsx";
import { KindBadge, StatusBadge } from "./StatusBadge.jsx";

function ImpactSummary({ impact, variations }) {
	if (!impact) return null;
	if (impact.error) return <p className="muted">Impact unavailable: {impact.error}</p>;
	const name = (id) => variations.find((variation) => variation.id === id)?.name || id;
	return (
		<div className="impact-inline">
			<p className="impact-summary">
				<strong>{impact.flipped}</strong> of {impact.audienceSize} audience members change variation.
			</p>
			<div className="impact-inline-grid">
				<div>
					<h4>Current</h4>
					<ul>
						{Object.entries(impact.before).map(([id, count]) => (
							<li key={id}>
								<span>{name(id)}</span>
								<strong>{count}</strong>
							</li>
						))}
					</ul>
				</div>
				<div>
					<h4>Proposed</h4>
					<ul>
						{Object.entries(impact.after).map(([id, count]) => (
							<li key={id}>
								<span>{name(id)}</span>
								<strong>{count}</strong>
							</li>
						))}
					</ul>
				</div>
			</div>
		</div>
	);
}

export function ChangeRequestDetailPage({ id }) {
	const { project } = useProject();
	const { profile, can } = useSession();
	const { notify } = useToast();
	const { data, error, loading, reload, mutate } = useAsync(() => changeRequestApi.get(id), [id]);
	const [dialog, setDialog] = useState(null);
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState("");
	const [rolloutError, setRolloutError] = useState(null);

	if (loading && !data) return <Skeleton rows={8} />;
	if (error?.code === "CHANGE_REQUEST_NOT_FOUND" || error?.code === "VALIDATION_ERROR") {
		return (
			<EmptyState
				action={{
					label: "Back to change requests",
					onClick: () => navigate(buildPath("changeRequests", { projectKey: project.key })),
				}}
				description="No change request with this identifier exists."
				icon="rate_review"
				title="Change request not found"
			/>
		);
	}
	if (error && !data) return <ErrorBanner message={error.message} onRetry={reload} />;

	const changeRequest = data;
	const environment =
		project.environments.find((candidate) => candidate.key === changeRequest.environment) || changeRequest.environmentPolicy;
	const isAuthor = String(changeRequest.authorId) === String(profile._id);
	const { permissions } = changeRequest;
	const terminal = ["applied", "rejected", "withdrawn"].includes(changeRequest.status);

	const run = async (action, message) => {
		setBusy(true);
		setFailure("");
		try {
			const updated = await action();
			mutate((previous) => ({ ...previous, ...updated, permissions: previous.permissions }));
			setDialog(null);
			if (message) notify({ kind: "success", message });
			await reload();
		} catch (caught) {
			if (caught.code === "ROLLOUT_ACTIVE") {
				setRolloutError(caught);
				setDialog(null);
			} else if (caught.code === "VERSION_CONFLICT") {
				setDialog(null);
				notify({ kind: "error", message: caught.message });
				await reload();
			} else setFailure(caught.message);
			throw caught;
		} finally {
			setBusy(false);
		}
	};

	const apply = (acknowledge) =>
		run(() => changeRequestApi.apply(changeRequest._id, acknowledge), `Applied to ${environment.name}.`).catch(() => {});

	const kindHeading =
		changeRequest.kind === "promotion"
			? `Promotion from ${project.environments.find((candidate) => candidate.key === changeRequest.sourceEnvironment)?.name || changeRequest.sourceEnvironment} v${changeRequest.sourceVersion}`
			: changeRequest.kind === "rollback"
				? `Rollback to v${changeRequest.sourceVersion}`
				: "Targeting change";

	return (
		<section className="page change-request-detail" aria-labelledby="cr-title">
			<nav aria-label="Breadcrumb" className="breadcrumb">
				<Link to={buildPath("changeRequests", { projectKey: project.key })}>Change requests</Link>
				<MaterialIcon size={16}>chevron_right</MaterialIcon>
				<span aria-current="page">{changeRequest.title}</span>
			</nav>
			{changeRequest.status === "conflicted" && (
				<div className="banner banner-warning" role="alert">
					<MaterialIcon size={20}>warning_amber</MaterialIcon>
					<div className="banner-body">
						<span>
							{environment.name} moved to v{changeRequest.currentVersion} after this proposal was made against v
							{changeRequest.baseVersion}. Rebase to re-apply it on the current version; reviews start over.
						</span>
					</div>
				</div>
			)}
			{changeRequest.flag.killSwitch?.active && (
				<div className="banner banner-danger" role="status">
					<MaterialIcon size={20}>bolt</MaterialIcon>
					<div className="banner-body">
						<span>
							The kill switch is active on {changeRequest.flag.name}; applying this change will not serve anything until it is
							cleared.
						</span>
					</div>
				</div>
			)}
			<header className="page-header">
				<div className="flag-title">
					<h1 id="cr-title">{changeRequest.title}</h1>
					<div className="flag-meta">
						<StatusBadge status={changeRequest.status} />
						<KindBadge kind={changeRequest.kind} />
						<span className="env-pill-key" style={{ "--env-color": environment.color }} aria-hidden="true" />
						<span>{environment.name}</span>
						<span>·</span>
						<Link
							className="flag-name"
							to={buildPath(
								"flag",
								{ projectKey: project.key, flagKey: changeRequest.flagKey },
								{ env: changeRequest.environment },
							)}
						>
							{changeRequest.flag.name}
						</Link>
						<code>{changeRequest.flagKey}</code>
					</div>
					<div className="flag-facts">
						<span className="flag-fact">
							{changeRequest.author && <ProfileAvatar profile={changeRequest.author} size="small" />}
							<span>
								{changeRequest.author?.name || "Unknown"} · {relativeTime(changeRequest.createdAt)}
							</span>
						</span>
						<span className="flag-fact muted">{kindHeading}</span>
						<span className="flag-fact muted">
							Base v{changeRequest.baseVersion} · current v{changeRequest.currentVersion}
						</span>
						{changeRequest.status === "applied" && (
							<span className="flag-fact muted">
								Applied as v{changeRequest.appliedVersion} by {changeRequest.appliedByPerson?.name || "unknown"}{" "}
								{relativeTime(changeRequest.appliedAt)}
							</span>
						)}
						{changeRequest.resolvedAt && changeRequest.status !== "applied" && (
							<span className="flag-fact muted">Closed {formatDateTime(changeRequest.resolvedAt)}</span>
						)}
					</div>
				</div>
				<div className="flag-header-actions">
					{!terminal && permissions.canEdit && changeRequest.kind === "manual" && (
						<Link
							className="tonal-button"
							to={buildPath(
								"flag",
								{ projectKey: project.key, flagKey: changeRequest.flagKey },
								{ env: changeRequest.environment, cr: changeRequest._id },
							)}
						>
							<MaterialIcon size={18}>edit</MaterialIcon> Edit proposal
						</Link>
					)}
					{changeRequest.status === "conflicted" && permissions.canEdit && (
						<button className="tonal-button" disabled={busy} type="button" onClick={() => setDialog("rebase")}>
							<MaterialIcon size={18}>sync</MaterialIcon> Rebase
						</button>
					)}
					{changeRequest.status === "approved" && permissions.canApply && (
						<button className="primary-button" disabled={busy} type="button" onClick={() => setDialog("apply")}>
							<MaterialIcon size={18}>check</MaterialIcon> Apply to {environment.name}
						</button>
					)}
					{changeRequest.status === "approved" && !permissions.canApply && (
						<button
							className="primary-button"
							disabled
							title="Only the author, release managers, and admins can apply."
							type="button"
						>
							<MaterialIcon size={18}>check</MaterialIcon> Apply
						</button>
					)}
					{!terminal && permissions.canWithdraw && (
						<button className="text-button" disabled={busy} type="button" onClick={() => setDialog("withdraw")}>
							Withdraw
						</button>
					)}
				</div>
			</header>

			{changeRequest.description && <p className="flag-description">{changeRequest.description}</p>}

			<div className="detail-grid">
				<section className="editor-section" aria-labelledby="diff-title">
					<div className="editor-section-header">
						<h3 id="diff-title">Proposed changes</h3>
						<span className="muted">
							Against {environment.name} v{changeRequest.currentVersion}
						</span>
					</div>
					<DiffView diff={changeRequest.diff} variations={changeRequest.flag.variations} />
				</section>
				<section className="editor-section" aria-labelledby="impact-title">
					<div className="editor-section-header">
						<h3 id="impact-title">Impact on the audience</h3>
					</div>
					<ImpactSummary impact={changeRequest.impact} variations={changeRequest.flag.variations} />
				</section>
			</div>

			<div className="detail-grid">
				<div className="editor-section">
					<ReviewPanel
						canReview={permissions.canReview}
						changeRequest={changeRequest}
						isAuthor={isAuthor}
						onReview={(decision, comment) =>
							run(
								() => changeRequestApi.review(changeRequest._id, decision, comment),
								decision === "approve" ? "Approved." : "Rejected.",
							)
						}
						reason={can("changeRequest:review") ? "" : "Reviewers, release managers, and admins can approve or reject."}
					/>
				</div>
				<div className="editor-section">
					<CommentThread
						canComment={permissions.canComment}
						comments={changeRequest.comments}
						onSubmit={(body) => run(() => changeRequestApi.comment(changeRequest._id, body))}
					/>
				</div>
			</div>

			{dialog === "apply" && (
				<ConfirmationDialog
					busy={busy}
					confirmLabel={`Apply to ${environment.name}`}
					error={failure}
					message={`${environment.name} moves to a new version with the proposed configuration. Every consumer of ${changeRequest.flagKey} sees it immediately.`}
					onCancel={() => setDialog(null)}
					onConfirm={() => apply(false)}
					title="Apply this change request?"
				/>
			)}
			{dialog === "rebase" && (
				<ConfirmationDialog
					busy={busy}
					confirmLabel="Rebase"
					error={failure}
					message={`The proposal is re-based on ${environment.name} v${changeRequest.currentVersion}. Existing reviews are cleared and reviewers are asked again.`}
					onCancel={() => setDialog(null)}
					onConfirm={() =>
						run(() => changeRequestApi.rebase(changeRequest._id), "Rebased; awaiting a fresh review.").catch(() => {})
					}
					title="Rebase onto the current version?"
				/>
			)}
			{dialog === "withdraw" && (
				<ConfirmationDialog
					busy={busy}
					confirmLabel="Withdraw"
					error={failure}
					message="A withdrawn request stays in the history but can no longer be reviewed or applied."
					onCancel={() => setDialog(null)}
					onConfirm={() => run(() => changeRequestApi.withdraw(changeRequest._id), "Withdrawn.").catch(() => {})}
					title="Withdraw this change request?"
				/>
			)}
			{rolloutError && (
				<RolloutActiveDialog
					busy={busy}
					environmentName={environment.name}
					error={rolloutError}
					onCancel={() => setRolloutError(null)}
					onConfirm={() => apply(true).then(() => setRolloutError(null))}
				/>
			)}
		</section>
	);
}
