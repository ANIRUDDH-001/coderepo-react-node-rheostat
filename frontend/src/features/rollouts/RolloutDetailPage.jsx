import { useState } from "react";
import { ConfirmationDialog } from "../../shared/components/ConfirmationDialog.jsx";
import { DiffView } from "../../shared/components/DiffView.jsx";
import { EmptyState } from "../../shared/components/EmptyState.jsx";
import { ErrorBanner } from "../../shared/components/ErrorBanner.jsx";
import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { Skeleton } from "../../shared/components/Skeleton.jsx";
import { useToast } from "../../shared/components/Toast.jsx";
import { useProject } from "../../shared/context/ProjectContext.jsx";
import { useAsync } from "../../shared/hooks/useAsync.js";
import { Link } from "../../shared/router/Link.jsx";
import { buildPath } from "../../shared/router/match.js";
import { navigate } from "../../shared/router/router.js";
import { RolloutTimeline } from "./RolloutTimeline.jsx";
import { rolloutApi } from "./rollout.api.js";

export function RolloutDetailPage({ id }) {
	const { project, reloadBadges } = useProject();
	const { notify } = useToast();
	const { data: plan, error, loading, reload } = useAsync(() => rolloutApi.get(id), [id]);
	const [dialog, setDialog] = useState(null);
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState("");
	if (loading && !plan) return <Skeleton rows={7} />;
	if (error?.code === "ROLLOUT_NOT_FOUND")
		return (
			<EmptyState
				action={{ label: "Back to rollouts", onClick: () => navigate(buildPath("rollouts", { projectKey: project.key })) }}
				description="This rollout no longer exists."
				icon="timeline"
				title="Rollout not found"
			/>
		);
	if (error && !plan) return <ErrorBanner message={error.message} onRetry={reload} />;
	const environment = project.environments.find((candidate) => candidate.key === plan.environment) || plan.environmentPolicy;
	const run = async (action, message) => {
		setBusy(true);
		setFailure("");
		try {
			await action();
			await reload();
			await reloadBadges?.();
			setDialog(null);
			notify({ kind: "success", message });
		} catch (caught) {
			setFailure(caught.message);
			throw caught;
		} finally {
			setBusy(false);
		}
	};
	const canManage = plan.permissions.canManage;
	return (
		<section className="page rollout-detail" aria-labelledby="rollout-title">
			<nav aria-label="Breadcrumb" className="breadcrumb">
				<Link to={buildPath("rollouts", { projectKey: project.key })}>Rollouts</Link>
				<MaterialIcon size={16}>chevron_right</MaterialIcon>
				<span aria-current="page">{plan.flag.name}</span>
			</nav>
			<header className="page-header">
				<div className="flag-title">
					<h1 id="rollout-title">{plan.flag.name}</h1>
					<div className="flag-meta">
						<code>{plan.flagKey}</code>
						<span>{environment.name}</span>
						<span className={`rollout-status rollout-status-${plan.status}`}>{plan.status}</span>
					</div>
					<p className="flag-description">
						From{" "}
						{plan.flag.variations.find((variation) => variation.id === plan.baselineVariationId)?.name ||
							plan.baselineVariationId}{" "}
						to{" "}
						{plan.flag.variations.find((variation) => variation.id === plan.targetVariationId)?.name || plan.targetVariationId}.
					</p>
				</div>
				<div className="flag-header-actions">
					{["scheduled", "running"].includes(plan.status) && (
						<button className="tonal-button" disabled={!canManage || busy} type="button" onClick={() => setDialog("pause")}>
							Pause
						</button>
					)}
					{["paused", "stalled"].includes(plan.status) && (
						<button className="primary-button" disabled={!canManage || busy} type="button" onClick={() => setDialog("resume")}>
							Resume
						</button>
					)}
					{["scheduled", "running", "paused", "stalled"].includes(plan.status) && (
						<button
							className="danger-outline-button"
							disabled={!canManage || busy}
							type="button"
							onClick={() => setDialog("abort")}
						>
							Abort
						</button>
					)}
				</div>
			</header>
			{plan.heldByKillSwitch && (
				<div className="banner banner-warning" role="status">
					<MaterialIcon size={20}>bolt</MaterialIcon>
					<div className="banner-body">
						<span>The kill switch is active. Due rollout steps are held until it is cleared.</span>
					</div>
				</div>
			)}
			{plan.status === "stalled" && (
				<section className="editor-section rollout-drift">
					<div className="editor-section-header">
						<h3>Targeting changed outside this rollout</h3>
						<span className="muted">
							Expected v{plan.drift.expectedVersion}; current v{plan.drift.currentVersion}
						</span>
					</div>
					{plan.drift.compatibility && <p className="form-error">{plan.drift.compatibility}</p>}
					<DiffView diff={plan.drift.diff} variations={plan.flag.variations} />
				</section>
			)}
			<section className="editor-section">
				<RolloutTimeline plan={plan} />
			</section>
			{plan.status === "aborted" && (
				<div className="banner banner-info" role="status">
					<div className="banner-body">
						<span>The live configuration was left unchanged. Remaining steps were skipped.</span>
					</div>
					<Link
						className="text-button"
						to={buildPath(
							"flag",
							{ projectKey: project.key, flagKey: plan.flagKey },
							{ env: plan.environment, tab: "history" },
						)}
					>
						Roll back to version {plan.startedFromVersion}
					</Link>
				</div>
			)}
			{dialog === "pause" && (
				<ConfirmationDialog
					busy={busy}
					confirmLabel="Pause rollout"
					error={failure}
					message="No pending steps apply while the rollout is paused. Resuming shifts their schedule by the paused time."
					onCancel={() => setDialog(null)}
					onConfirm={() => run(() => rolloutApi.pause(id), "Rollout paused.").catch(() => {})}
					title="Pause this rollout?"
				/>
			)}
			{dialog === "resume" && (
				<ConfirmationDialog
					busy={busy}
					confirmLabel="Resume rollout"
					error={failure}
					message={
						plan.status === "stalled"
							? "Resume adopts the current targeting version. Review the outside-change diff above before continuing."
							: "Pending steps resume on a schedule shifted by the paused duration."
					}
					onCancel={() => setDialog(null)}
					onConfirm={() => run(() => rolloutApi.resume(id), "Rollout resumed.").catch(() => {})}
					title={plan.status === "stalled" ? "Resume this stalled rollout?" : "Resume this rollout?"}
				/>
			)}
			{dialog === "abort" && (
				<ConfirmationDialog
					busy={busy}
					confirmLabel="Abort rollout"
					error={failure}
					message="The live configuration stays as it is. All remaining rollout steps are skipped."
					onCancel={() => setDialog(null)}
					onConfirm={() => run(() => rolloutApi.abort(id), "Rollout aborted.").catch(() => {})}
					title="Abort this rollout?"
				/>
			)}
		</section>
	);
}
