import { useState } from "react";
import { ConfirmationDialog } from "../../shared/components/ConfirmationDialog.jsx";
import { EmptyState } from "../../shared/components/EmptyState.jsx";
import { ErrorBanner } from "../../shared/components/ErrorBanner.jsx";
import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { Skeleton } from "../../shared/components/Skeleton.jsx";
import { useToast } from "../../shared/components/Toast.jsx";
import { useProject } from "../../shared/context/ProjectContext.jsx";
import { useAsync } from "../../shared/hooks/useAsync.js";
import { Link } from "../../shared/router/Link.jsx";
import { buildPath } from "../../shared/router/match.js";
import { relativeTime } from "../../shared/utils/date.js";
import { Inbox } from "./Inbox.jsx";
import { StatusBadge } from "./StatusBadge.jsx";
import { WebhookFormDialog } from "./WebhookFormDialog.jsx";
import { webhookApi } from "./webhook.api.js";

const hostOf = (url) => {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
};

// Toast text for a test delivery: the row comes back after its first attempt.
export const describeTest = (delivery) => {
	const attempt = delivery.lastAttempt || delivery.attempts?.at(-1);
	if (delivery.status === "delivered") return `Test delivered (HTTP ${attempt?.responseStatus ?? 200} in ${attempt?.durationMs ?? 0} ms)`;
	const why = attempt?.responseStatus ? `HTTP ${attempt.responseStatus}` : attempt?.error || "no response";
	return `Test failed: ${why} — ${delivery.status === "dead" ? "dead-lettered" : "retrying"}`;
};

export function WebhooksTab() {
	const { project, reloadBadges } = useProject();
	const { notify } = useToast();
	const { data, error, loading, reload } = useAsync(() => webhookApi.list(project.key), [project.key], { key: `webhooks:${project.key}` });
	const [dialog, setDialog] = useState(null); // { kind: "create" } | { kind: "edit", subscription } | { kind: "delete", subscription } | { kind: "clear" }
	const [busyId, setBusyId] = useState("");
	const [actionError, setActionError] = useState("");
	const [inboxEpoch, setInboxEpoch] = useState(0);

	if (loading && !data) return <Skeleton rows={5} />;
	if (error && !data)
		return <ErrorBanner message={error.message} requestId={error.status >= 500 ? error.requestId : ""} onRetry={reload} />;
	const { items, sinkUrl, permissions } = data;
	const canManage = permissions.canManage;

	const run = async (id, action, success) => {
		setBusyId(id);
		setActionError("");
		try {
			const result = await action();
			notify({ kind: "success", message: typeof success === "function" ? success(result) : success });
			reload();
			reloadBadges?.();
			return result;
		} catch (caught) {
			setActionError(caught.message);
			notify({ kind: "error", message: caught.message });
		} finally {
			setBusyId("");
		}
		return null;
	};
	const copySink = async () => {
		try {
			await navigator.clipboard.writeText(sinkUrl);
			notify({ kind: "success", message: "Receiver URL copied." });
		} catch {
			notify({ kind: "error", message: "Could not copy — select the URL and copy it manually." });
		}
	};
	const environmentNames = (keys) =>
		keys.length ? keys.map((key) => project.environments.find((environment) => environment.key === key)?.name || key).join(", ") : "All";

	return (
		<>
			<section className="editor-section sink-card" aria-labelledby="settings-sink-title">
				<div className="editor-section-header">
					<h3 id="settings-sink-title">Built-in test receiver</h3>
					<span className="muted">Point a webhook here to see signed deliveries land in the inbox without any external service.</span>
				</div>
				<div className="sink-card-row">
					<code className="sink-url">{sinkUrl}</code>
					<div className="sink-card-actions">
						<button className="tonal-button" type="button" onClick={copySink}>
							<MaterialIcon size={18}>content_copy</MaterialIcon> Copy
						</button>
						{canManage && (
							<button className="text-button" type="button" onClick={() => setDialog({ kind: "clear" })}>
								<MaterialIcon size={18}>cleaning_services</MaterialIcon> Clear inbox
							</button>
						)}
					</div>
				</div>
				<Inbox epoch={inboxEpoch} projectKey={project.key} />
			</section>
			<section className="editor-section" aria-labelledby="settings-webhooks-title">
				<div className="editor-section-header">
					<h3 id="settings-webhooks-title">Webhooks</h3>
					{canManage && items.length > 0 && (
						<button className="tonal-button" type="button" onClick={() => setDialog({ kind: "create" })}>
							<MaterialIcon size={18}>add</MaterialIcon> New webhook
						</button>
					)}
				</div>
				{actionError && <ErrorBanner message={actionError} />}
				{!items.length ? (
					<EmptyState
						action={
							canManage ? (
								<button className="primary-button" type="button" onClick={() => setDialog({ kind: "create" })}>
									<MaterialIcon size={18}>add</MaterialIcon> New webhook
								</button>
							) : null
						}
						description="Notify your tools when flags change."
						icon="webhook"
						title="No webhooks yet"
					/>
				) : (
					<div className="table-wrap">
						<table className="data-table webhook-table">
							<thead>
								<tr>
									<th>Name</th>
									<th>Host</th>
									<th>Events</th>
									<th>Environments</th>
									<th>Status</th>
									<th className="numeric-cell">Delivered</th>
									<th className="numeric-cell">Dead</th>
									<th className="numeric-cell">Held</th>
									<th>Last delivery</th>
									{canManage && <th className="row-actions">Actions</th>}
								</tr>
							</thead>
							<tbody>
								{items.map((subscription) => (
									<tr key={subscription._id}>
										<td>
											<Link to={buildPath("webhook", { projectKey: project.key, id: subscription._id })}>{subscription.name}</Link>
										</td>
										<td>
											<code>{hostOf(subscription.url)}</code>
										</td>
										<td title={subscription.events.join("\n")}>
											{subscription.events.length} event{subscription.events.length === 1 ? "" : "s"}
										</td>
										<td>{environmentNames(subscription.environments)}</td>
										<td>
											<StatusBadge subscription={subscription} />
										</td>
										<td className="numeric-cell">{subscription.counts.delivered}</td>
										<td className={`numeric-cell ${subscription.counts.dead ? "danger-text" : ""}`}>{subscription.counts.dead}</td>
										<td className="numeric-cell">{subscription.counts.held}</td>
										<td>{subscription.lastDeliveryAt ? relativeTime(subscription.lastDeliveryAt) : "Never"}</td>
										{canManage && (
											<td className="row-actions">
												<button
													className="text-button"
													disabled={busyId === subscription._id || !subscription.enabled}
													title={subscription.enabled ? "Send a webhook.test event now" : "Enable the webhook before sending a test"}
													type="button"
													onClick={() => run(subscription._id, () => webhookApi.test(subscription._id, project.key), describeTest)}
												>
													<MaterialIcon size={18}>send</MaterialIcon> Test
												</button>
												<button
													className="text-button"
													disabled={busyId === subscription._id}
													type="button"
													onClick={() =>
														run(
															subscription._id,
															() => webhookApi.update(subscription._id, { enabled: !subscription.enabled }, project.key),
															subscription.enabled ? "Webhook disabled; pending deliveries are held." : "Webhook enabled; held deliveries resume.",
														)
													}
												>
													<MaterialIcon size={18}>{subscription.enabled ? "pause" : "play_arrow"}</MaterialIcon>
													{subscription.enabled ? "Disable" : "Enable"}
												</button>
												<button
													className="text-button"
													disabled={busyId === subscription._id}
													type="button"
													onClick={() => setDialog({ kind: "edit", subscription })}
												>
													<MaterialIcon size={18}>edit</MaterialIcon> Edit
												</button>
												<button
													className="text-button danger-text"
													disabled={busyId === subscription._id}
													type="button"
													onClick={() => setDialog({ kind: "delete", subscription })}
												>
													<MaterialIcon size={18}>delete</MaterialIcon> Delete
												</button>
											</td>
										)}
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>
			{(dialog?.kind === "create" || dialog?.kind === "edit") && (
				<WebhookFormDialog
					initial={dialog.kind === "edit" ? dialog.subscription : null}
					projectKey={project.key}
					sinkUrl={sinkUrl}
					onClose={() => setDialog(null)}
					onSaved={(saved) => {
						setDialog(null);
						notify({ kind: "success", message: dialog.kind === "edit" ? `Webhook "${saved.name}" saved.` : `Webhook "${saved.name}" created.` });
						reload();
						reloadBadges?.();
					}}
				/>
			)}
			{dialog?.kind === "delete" && (
				<ConfirmationDialog
					busy={busyId === dialog.subscription._id}
					confirmLabel="Delete webhook"
					message={`Delete "${dialog.subscription.name}" and its delivery history? Receivers keep whatever they already stored.`}
					title="Delete webhook"
					onCancel={() => setDialog(null)}
					onConfirm={async () => {
						await run(dialog.subscription._id, () => webhookApi.remove(dialog.subscription._id, project.key), `Webhook "${dialog.subscription.name}" deleted.`);
						setDialog(null);
					}}
				/>
			)}
			{dialog?.kind === "clear" && (
				<ConfirmationDialog
					busy={busyId === "clear"}
					confirmLabel="Clear inbox"
					message="Remove every receipt the built-in receiver has stored for this project?"
					title="Clear inbox"
					onCancel={() => setDialog(null)}
					onConfirm={async () => {
						await run("clear", () => webhookApi.clearReceipts(project.key), "Inbox cleared.");
						setInboxEpoch((value) => value + 1);
						setDialog(null);
					}}
				/>
			)}
		</>
	);
}
