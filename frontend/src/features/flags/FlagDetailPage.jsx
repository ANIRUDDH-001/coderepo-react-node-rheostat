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
import { buildPath } from "../../shared/router/match.js";
import { navigate, useRoute } from "../../shared/router/router.js";
import { formatDateTime } from "../../shared/utils/date.js";
import { segmentApi } from "../segments/segment.api.js";
import { EnvironmentTabs } from "./EnvironmentTabs.jsx";
import { flagApi } from "./flag.api.js";
import { FlagHeader } from "./FlagHeader.jsx";
import { FlagMetadataDialog } from "./FlagMetadataDialog.jsx";
import { KillSwitchDialog } from "./KillSwitchDialog.jsx";
import { TargetingEditor } from "./TargetingEditor.jsx";
import { VersionHistory } from "./VersionHistory.jsx";

export function FlagDetailPage({ flagKey }) {
	const { project } = useProject();
	const { can } = useSession();
	const { query, setQuery } = useRoute();
	const { notify } = useToast();
	const { data: flag, error, loading, reload } = useAsync(() => flagApi.get(project.key, flagKey), [project.key, flagKey]);
	const segmentsState = useAsync(() => segmentApi.list(project.key), [project.key]);
	const [dialog, setDialog] = useState(null);
	const [busy, setBusy] = useState(false);
	const [dialogError, setDialogError] = useState("");

	const environments = project.environments;
	const environment = environments.find((candidate) => candidate.key === query.env) || environments[0];
	const tab = query.tab === "history" ? "history" : "targeting";

	if (loading && !flag) return <Skeleton rows={8} />;
	if (error?.code === "FLAG_NOT_FOUND") {
		return (
			<EmptyState
				action={{ label: "Back to flags", onClick: () => navigate(buildPath("flags", { projectKey: project.key })) }}
				description={`No flag with key ${flagKey} exists in ${project.name}.`}
				icon="flag"
				title="Flag not found"
			/>
		);
	}
	if (error && !flag) return <ErrorBanner message={error.message} onRetry={reload} />;

	const config = flag.environments[environment.key];

	// Every mutation re-fetches the decorated flag (owner, kill-switch actor, active rollouts) rather than patching locally.
	const run = async (action, successMessage) => {
		setBusy(true);
		setDialogError("");
		try {
			await action();
			await reload();
			setDialog(null);
			if (successMessage) notify({ kind: "success", message: successMessage });
		} catch (caught) {
			setDialogError(caught.message);
			throw caught;
		} finally {
			setBusy(false);
		}
	};

	const canKill = can("flag:killSwitch");
	const canEditConfig = !flag.archived && !environment.protected && can("flag:editConfig:unprotected");
	const notice = flag.archived
		? "This flag is archived. Restore it to change targeting."
		: environment.protected
			? `${environment.name} changes require a change request${can("changeRequest:create") ? "" : ", which your role cannot open"}.`
			: can("flag:editConfig:unprotected")
				? ""
				: "Your role can view targeting but not change it.";

	const actions = (
		<>
			{can("flag:editMetadata") && !flag.archived && (
				<button className="tonal-button" type="button" onClick={() => setDialog("edit")}>
					<MaterialIcon size={18}>edit</MaterialIcon> Edit
				</button>
			)}
			{canKill && !flag.killSwitch.active && !flag.archived && (
				<button className="danger-outline-button" type="button" onClick={() => setDialog("kill")}>
					<MaterialIcon size={18}>bolt</MaterialIcon> Kill switch
				</button>
			)}
			{can("flag:archive") && !flag.archived && (
				<button className="text-button" type="button" onClick={() => setDialog("archive")}>
					<MaterialIcon size={18}>archive</MaterialIcon> Archive
				</button>
			)}
			{can("flag:restore") && flag.archived && (
				<button className="tonal-button" type="button" onClick={() => setDialog("restore")}>
					<MaterialIcon size={18}>unarchive</MaterialIcon> Restore
				</button>
			)}
		</>
	);

	return (
		<section className="page flag-detail" aria-labelledby="flag-title">
			{flag.killSwitch.active && (
				<div className="banner banner-danger kill-banner" role="alert">
					<MaterialIcon size={22}>bolt</MaterialIcon>
					<div className="banner-body">
						<strong>Kill switch active — every environment serves the off variation.</strong>
						<span>
							{flag.killSwitch.reason}
							{flag.killSwitch.actor ? ` — ${flag.killSwitch.actor.name}` : ""}
							{flag.killSwitch.activatedAt ? `, ${formatDateTime(flag.killSwitch.activatedAt)}` : ""}
						</span>
					</div>
					{canKill && (
						<button className="text-button" type="button" onClick={() => setDialog("clear")}>
							Clear
						</button>
					)}
				</div>
			)}
			{flag.archived && (
				<div className="banner banner-warning" role="status">
					<MaterialIcon size={20}>archive</MaterialIcon>
					<div className="banner-body">
						<span>This flag is archived and hidden from the default list. Targeting is read-only until it is restored.</span>
					</div>
				</div>
			)}
			<FlagHeader actions={actions} flag={flag} projectKey={project.key} />
			<EnvironmentTabs
				environment={environment}
				environments={environments}
				flag={flag}
				onEnvironment={(env) => setQuery({ env })}
				onTab={(next) => setQuery({ tab: next === "targeting" ? "" : next })}
				tab={tab}
			/>
			{tab === "targeting" ? (
				segmentsState.error ? (
					<ErrorBanner message={`Segments could not be loaded: ${segmentsState.error.message}`} onRetry={segmentsState.reload} />
				) : segmentsState.loading && !segmentsState.data ? (
					<Skeleton rows={5} />
				) : (
					<TargetingEditor
						canEdit={canEditConfig}
						config={config}
						environment={environment}
						flag={flag}
						key={`${environment.key}:${config.version}`}
						notice={notice}
						onSaved={() => reload()}
						segments={segmentsState.data}
					/>
				)
			) : (
				<VersionHistory environment={environment} flag={flag} onRolledBack={() => reload()} />
			)}

			{dialog === "edit" && (
				<FlagMetadataDialog
					flag={flag}
					onClose={() => setDialog(null)}
					onSave={(patch) => run(() => flagApi.updateMetadata(project.key, flag.key, patch), "Flag details saved.")}
				/>
			)}
			{dialog === "kill" && (
				<KillSwitchDialog
					flag={flag}
					onClose={() => setDialog(null)}
					onConfirm={(reason) => run(() => flagApi.killSwitch(project.key, flag.key, reason), "Kill switch activated.")}
				/>
			)}
			{dialog === "clear" && (
				<ConfirmationDialog
					busy={busy}
					confirmLabel="Clear kill switch"
					error={dialogError}
					message="Each environment goes back to its saved targeting immediately."
					onCancel={() => setDialog(null)}
					onConfirm={() => run(() => flagApi.clearKillSwitch(project.key, flag.key), "Kill switch cleared.").catch(() => {})}
					title="Clear the kill switch?"
				/>
			)}
			{dialog === "archive" && (
				<ConfirmationDialog
					busy={busy}
					confirmLabel="Archive"
					error={dialogError}
					message="Archived flags disappear from the default list and stop being evaluated in the playground. You can restore them later."
					onCancel={() => setDialog(null)}
					onConfirm={() => run(() => flagApi.archive(project.key, flag.key), `${flag.key} archived.`).catch(() => {})}
					title={`Archive ${flag.name}?`}
				/>
			)}
			{dialog === "restore" && (
				<ConfirmationDialog
					busy={busy}
					confirmLabel="Restore"
					error={dialogError}
					message="The flag returns to the list with its previous targeting."
					onCancel={() => setDialog(null)}
					onConfirm={() => run(() => flagApi.restore(project.key, flag.key), `${flag.key} restored.`).catch(() => {})}
					title={`Restore ${flag.name}?`}
				/>
			)}
		</section>
	);
}
