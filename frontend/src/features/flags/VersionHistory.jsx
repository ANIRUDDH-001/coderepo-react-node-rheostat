import { useState } from "react";
import { ConfirmationDialog } from "../../shared/components/ConfirmationDialog.jsx";
import { EmptyState } from "../../shared/components/EmptyState.jsx";
import { ErrorBanner } from "../../shared/components/ErrorBanner.jsx";
import { Skeleton } from "../../shared/components/Skeleton.jsx";
import { useToast } from "../../shared/components/Toast.jsx";
import { useProject } from "../../shared/context/ProjectContext.jsx";
import { useSession } from "../../shared/context/SessionContext.jsx";
import { useAsync } from "../../shared/hooks/useAsync.js";
import { flagApi } from "./flag.api.js";
import { RolloutActiveDialog } from "./RolloutActiveDialog.jsx";
import { VersionCard } from "./VersionCard.jsx";

export function VersionHistory({ environment, flag, onRolledBack, onProposeRollback = null }) {
	const { project } = useProject();
	const { can } = useSession();
	const { notify } = useToast();
	const { data, error, loading, reload } = useAsync(
		() => flagApi.versions(project.key, flag.key, environment.key),
		[project.key, flag.key, environment.key, flag.environments[environment.key].version, flag.killSwitch.active],
	);
	const [target, setTarget] = useState(null);
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState("");
	const [rolloutError, setRolloutError] = useState(null);
	const currentVersion = flag.environments[environment.key].version;
	const canDirect = !environment.protected && can("flag:editConfig:unprotected") && !flag.archived;
	const canPropose = environment.protected && can("changeRequest:create") && !flag.archived;

	const rollback = async (acknowledgeActiveRollout = false) => {
		setBusy(true);
		setFailure("");
		try {
			const result = await flagApi.rollback(project.key, flag.key, environment.key, { version: target.version, ...(acknowledgeActiveRollout ? { acknowledgeActiveRollout: true } : {}) });
			setTarget(null);
			setRolloutError(null);
			notify({ kind: "success", message: `${environment.name} rolled back to v${target.version} (now v${result.version.version}).` });
			onRolledBack(result);
		} catch (caught) {
			if (caught.code === "ROLLOUT_ACTIVE") setRolloutError(caught);
			else setFailure(caught.message);
		} finally {
			setBusy(false);
		}
	};

	const rollbackAction = canDirect
		? { label: "Roll back to this version", onClick: setTarget, disabled: false }
		: canPropose
			? { label: "Propose rollback", onClick: (entry) => onProposeRollback?.(entry), disabled: !onProposeRollback, title: onProposeRollback ? "" : "Production changes require a change request." }
			: null;

	if (loading && !data) return <Skeleton rows={4} />;
	if (error) return <ErrorBanner message={error.message} onRetry={reload} />;
	if (!data?.length) return <EmptyState description="Versions appear here as the configuration changes." icon="history" title="No history yet" />;
	return (
		<div className="version-history">
			<ol className="timeline">
				{data.map((entry) => (
					<VersionCard current={entry.kind === "version" && entry.version === currentVersion} entry={entry} key={entry._id} rollback={rollbackAction} variations={flag.variations} />
				))}
			</ol>
			{target && !rolloutError && (
				<ConfirmationDialog
					busy={busy}
					confirmLabel="Roll back"
					error={failure}
					message={`${environment.name} will get a new version identical to v${target.version}. The current v${currentVersion} stays in history.`}
					onCancel={() => setTarget(null)}
					onConfirm={() => rollback(false)}
					title={`Roll back to v${target.version}?`}
				/>
			)}
			{rolloutError && (
				<RolloutActiveDialog busy={busy} environmentName={environment.name} error={rolloutError} onCancel={() => setRolloutError(null)} onConfirm={() => rollback(true)} />
			)}
		</div>
	);
}
