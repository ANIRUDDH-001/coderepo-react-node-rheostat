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
import { navigate, useRoute } from "../../shared/router/router.js";
import { formatDateTime, relativeTime } from "../../shared/utils/date.js";
import { changeRequestApi } from "../change-requests/change-request.api.js";
import { ChangeRequestComposer } from "../change-requests/ChangeRequestComposer.jsx";
import { KindBadge, StatusBadge } from "../change-requests/StatusBadge.jsx";
import { segmentApi } from "../segments/segment.api.js";
import { EnvironmentCompare } from "./EnvironmentCompare.jsx";
import { EnvironmentTabs } from "./EnvironmentTabs.jsx";
import { flagApi } from "./flag.api.js";
import { FlagHeader } from "./FlagHeader.jsx";
import { FlagMetadataDialog } from "./FlagMetadataDialog.jsx";
import { KillSwitchDialog } from "./KillSwitchDialog.jsx";
import { TargetingEditor } from "./TargetingEditor.jsx";
import { VersionHistory } from "./VersionHistory.jsx";
import { RolloutPlanner } from "../rollouts/RolloutPlanner.jsx";
import { rolloutApi } from "../rollouts/rollout.api.js";

const TERMINAL = new Set(["applied", "rejected", "withdrawn"]);

function OpenChangeRequests({ environmentName, items, projectKey }) {
	if (!items.length) return null;
	return (
		<section className="open-change-requests" aria-label={`Open change requests for ${environmentName}`}>
			<div className="editor-section-header">
				<h3>Open change requests for {environmentName}</h3>
			</div>
			<ul className="open-change-request-list">
				{items.map((item) => (
					<li key={item._id}>
						<StatusBadge status={item.status} />
						<KindBadge kind={item.kind} />
						<Link to={buildPath("changeRequest", { projectKey, id: item._id })}>{item.title}</Link>
						<span className="muted">
							{item.author?.name || "Unknown"} · {relativeTime(item.createdAt)} · {item.approvals} approval
							{item.approvals === 1 ? "" : "s"}
						</span>
					</li>
				))}
			</ul>
		</section>
	);
}

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
	// `proposal` is a payload (or a rollback target) waiting for a title and description in the composer.
	const [proposal, setProposal] = useState(null);

	const environments = project.environments;
	const environment = environments.find((candidate) => candidate.key === query.env) || environments[0];
	const tab = query.tab === "history" ? "history" : "targeting";
	// `?cr=<id>` opens an existing proposal for editing; it must belong to this flag and environment and still be editable.
	const editingId = query.cr || "";
	const editing = useAsync(() => (editingId ? changeRequestApi.get(editingId) : Promise.resolve(null)), [editingId]);

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
	if (error && !flag)
		return <ErrorBanner message={error.message} requestId={error.status >= 500 ? error.requestId : ""} onRetry={reload} />;

	const config = flag.environments[environment.key];

	// Every mutation re-fetches the decorated flag (owner, kill-switch actor, open change requests) rather than patching locally.
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
	const canPropose = !flag.archived && environment.protected && can("changeRequest:create");
	const canPlan = !flag.archived && can(`rollout:manage:${environment.protected ? "protected" : "unprotected"}`) && config.enabled;
	const editingRequest = editing.data;
	const editable = Boolean(
		editingRequest &&
			editingRequest.flagKey === flag.key &&
			editingRequest.environment === environment.key &&
			editingRequest.kind === "manual" &&
			!TERMINAL.has(editingRequest.status) &&
			editingRequest.permissions.canEdit,
	);
	let editingProblem = "";
	if (editingId && !editing.loading && !editable) {
		if (editing.error) editingProblem = editing.error.message;
		else if (editingRequest)
			editingProblem =
				"That change request cannot be edited here: it belongs to another flag or environment, is not a manual proposal, or is closed.";
	}
	const notice = flag.archived
		? "This flag is archived. Restore it to change targeting."
		: editable
			? `Editing the proposal "${editingRequest.title}". Saving updates the change request and restarts its review.`
			: environment.protected
				? `${environment.name} is protected: saving opens a change request for review${can("changeRequest:create") ? "" : ", which your role cannot do"}.`
				: can("flag:editConfig:unprotected")
					? ""
					: "Your role can view targeting but not change it.";
	const openForEnvironment = (flag.openChangeRequests || []).filter((item) => item.environment === environment.key);

	const submitProposal = async ({ title, description }) => {
		if (editable) {
			await changeRequestApi.edit(editingRequest._id, { proposedConfig: proposal.payload, title, description });
			notify({ kind: "success", message: "Proposal updated; reviews start over." });
			navigate(buildPath("changeRequest", { projectKey: project.key, id: editingRequest._id }));
			return;
		}
		const created = await changeRequestApi.create(project.key, {
			flagKey: flag.key,
			environment: environment.key,
			proposedConfig: proposal.payload,
			title,
			description,
		});
		notify({ kind: "success", message: "Change request opened." });
		navigate(buildPath("changeRequest", { projectKey: project.key, id: created._id }));
	};

	// Rollbacks into a protected environment carry a server-generated title, so they only need confirmation.
	const proposeRollback = async () => {
		setBusy(true);
		setDialogError("");
		try {
			const result = await flagApi.rollback(project.key, flag.key, environment.key, { version: proposal.version });
			notify({ kind: "success", message: "Rollback proposed as a change request." });
			navigate(buildPath("changeRequest", { projectKey: project.key, id: result.changeRequest._id }));
		} catch (caught) {
			setDialogError(caught.message);
			setBusy(false);
		}
	};

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
				actions={
					environments.length > 1 && !flag.archived ? (
						<button className="text-button" type="button" onClick={() => setDialog("compare")}>
							<MaterialIcon size={18}>compare_arrows</MaterialIcon> Compare &amp; promote
						</button>
					) : null
				}
				environment={environment}
				environments={environments}
				flag={flag}
				onEnvironment={(env) => setQuery({ env, cr: "" })}
				onPlan={canPlan ? () => setDialog("rollout") : null}
				onTab={(next) => setQuery({ tab: next === "targeting" ? "" : next })}
				projectKey={project.key}
				tab={tab}
			/>
			{editingProblem && (
				<div className="banner banner-warning" role="alert">
					<MaterialIcon size={20}>warning_amber</MaterialIcon>
					<div className="banner-body">
						<span>{editingProblem}</span>
					</div>
					<button className="text-button" type="button" onClick={() => setQuery({ cr: "" })}>
						Dismiss
					</button>
				</div>
			)}
			{tab === "targeting" ? (
				segmentsState.error ? (
					<ErrorBanner message={`Segments could not be loaded: ${segmentsState.error.message}`} onRetry={segmentsState.reload} />
				) : (segmentsState.loading && !segmentsState.data) || (editingId && editing.loading && !editing.data) ? (
					<Skeleton rows={5} />
				) : (
					<>
						{!editable && (
							<OpenChangeRequests environmentName={environment.name} items={openForEnvironment} projectKey={project.key} />
						)}
						<TargetingEditor
							canEdit={canEditConfig || canPropose}
							config={config}
							environment={environment}
							flag={flag}
							initialDraft={editable ? editingRequest.proposedConfig : null}
							key={`${environment.key}:${config.version}:${editable ? editingRequest._id : ""}`}
							mode={environment.protected ? "propose" : "direct"}
							notice={notice}
							onPropose={(payload) => setProposal({ kind: "config", payload })}
							onSaved={() => reload()}
							proposeLabel={editable ? "Update proposal" : "Propose change"}
							segments={segmentsState.data}
						/>
					</>
				)
			) : (
				<VersionHistory
					environment={environment}
					flag={flag}
					onProposeRollback={canPropose ? (entry) => setProposal({ kind: "rollback", version: entry.version }) : null}
					onRolledBack={() => reload()}
				/>
			)}

			{proposal?.kind === "config" && (
				<ChangeRequestComposer
					environmentName={environment.name}
					flagName={flag.name}
					initialDescription={editable ? editingRequest.description : ""}
					initialTitle={editable ? editingRequest.title : ""}
					onClose={() => setProposal(null)}
					onSubmit={submitProposal}
					submitLabel={editable ? "Update proposal" : "Propose change"}
				/>
			)}
			{proposal?.kind === "rollback" && (
				<ConfirmationDialog
					busy={busy}
					confirmLabel="Propose rollback"
					error={dialogError}
					message={`${environment.name} is protected, so restoring v${proposal.version} opens a change request that a reviewer must approve before it applies.`}
					onCancel={() => setProposal(null)}
					onConfirm={proposeRollback}
					title={`Propose rolling back to v${proposal.version}?`}
				/>
			)}
			{dialog === "compare" && (
				<EnvironmentCompare
					environment={environment}
					flag={flag}
					onClose={() => setDialog(null)}
					onPromoted={() => {
						setDialog(null);
						reload();
					}}
				/>
			)}
			{dialog === "rollout" && (
				<RolloutPlanner
					config={config}
					environment={environment}
					flag={flag}
					onClose={() => setDialog(null)}
					onCreate={async (input) => {
						const created = await rolloutApi.create(project.key, input);
						notify({ kind: "success", message: "Rollout created." });
						navigate(buildPath("rollout", { projectKey: project.key, id: created._id }));
					}}
				/>
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
