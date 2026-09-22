import { useState } from "react";
import { createPortal } from "react-dom";
import { Badge } from "../../shared/components/Badge.jsx";
import { ConfirmationDialog } from "../../shared/components/ConfirmationDialog.jsx";
import { EmptyState } from "../../shared/components/EmptyState.jsx";
import { ErrorBanner } from "../../shared/components/ErrorBanner.jsx";
import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { Modal } from "../../shared/components/Modal.jsx";
import { Skeleton } from "../../shared/components/Skeleton.jsx";
import { useToast } from "../../shared/components/Toast.jsx";
import { useProject } from "../../shared/context/ProjectContext.jsx";
import { useAsync } from "../../shared/hooks/useAsync.js";
import { Link } from "../../shared/router/Link.jsx";
import { buildPath } from "../../shared/router/match.js";
import { navigate } from "../../shared/router/router.js";
import { describeTest } from "./delivery-text.js";
import { DeliveryList } from "./DeliveryList.jsx";
import { SecretReveal } from "./SecretReveal.jsx";
import { StatusBadge } from "./StatusBadge.jsx";
import { WebhookFormDialog } from "./WebhookFormDialog.jsx";
import { webhookApi } from "./webhook.api.js";

export function WebhookDetailPage({ id }) {
	const { project, reloadBadges } = useProject();
	const { notify } = useToast();
	const { data: subscription, error, loading, reload } = useAsync(() => webhookApi.get(id), [id], { key: `webhook:${id}` });
	const [dialog, setDialog] = useState(null); // edit | rotate | delete | { secret }
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState("");
	const [epoch, setEpoch] = useState(0);
	const settingsPath = buildPath("settings", { projectKey: project.key }, { tab: "webhooks" });

	if (loading && !subscription) return <Skeleton rows={7} />;
	if (error?.code === "WEBHOOK_NOT_FOUND")
		return (
			<EmptyState
				action={{ label: "Back to webhooks", onClick: () => navigate(settingsPath) }}
				description="This webhook no longer exists."
				icon="webhook"
				title="Webhook not found"
			/>
		);
	if (error && !subscription)
		return <ErrorBanner message={error.message} requestId={error.status >= 500 ? error.requestId : ""} onRetry={reload} />;

	const canManage = subscription.permissions.canManage;
	const run = async (action, message) => {
		setBusy(true);
		setFailure("");
		try {
			const result = await action();
			await reload();
			reloadBadges?.();
			setEpoch((value) => value + 1);
			notify({ kind: "success", message: typeof message === "function" ? message(result) : message });
			return result;
		} catch (caught) {
			setFailure(caught.message);
			notify({ kind: "error", message: caught.message });
			return null;
		} finally {
			setBusy(false);
		}
	};
	const environmentNames = subscription.environments.length
		? subscription.environments.map((key) => project.environments.find((environment) => environment.key === key)?.name || key).join(", ")
		: "All environments";

	return (
		<section className="page webhook-detail-page" aria-labelledby="webhook-title">
			<nav aria-label="Breadcrumb" className="breadcrumb">
				<Link to={buildPath("settings", { projectKey: project.key })}>Settings</Link>
				<MaterialIcon size={16}>chevron_right</MaterialIcon>
				<Link to={settingsPath}>Webhooks</Link>
				<MaterialIcon size={16}>chevron_right</MaterialIcon>
				<span>{subscription.name}</span>
			</nav>
			<header className="page-header">
				<div className="webhook-detail-header">
					<h1 id="webhook-title">
						{subscription.name} <StatusBadge subscription={subscription} />
					</h1>
					<div className="webhook-meta">
						<code>{subscription.url}</code>
						<span>·</span>
						<span>{environmentNames}</span>
						<span>·</span>
						<span>Secret …{subscription.secretHint}</span>
					</div>
					<div className="webhook-events" aria-label="Subscribed events">
						{subscription.events.map((event) => (
							<Badge key={event}>{event}</Badge>
						))}
					</div>
				</div>
				{canManage && (
					<div className="webhook-actions">
						<button
							className="tonal-button"
							disabled={busy || !subscription.enabled}
							title={subscription.enabled ? "Send a webhook.test event now" : "Enable the webhook before sending a test"}
							type="button"
							onClick={() => run(() => webhookApi.test(id, project.key), describeTest)}
						>
							<MaterialIcon size={18}>send</MaterialIcon> Test
						</button>
						<button
							className="text-button"
							disabled={busy}
							type="button"
							onClick={() =>
								run(
									() => webhookApi.update(id, { enabled: !subscription.enabled }, project.key),
									subscription.enabled ? "Webhook disabled; pending deliveries are held." : "Webhook enabled; held deliveries resume.",
								)
							}
						>
							<MaterialIcon size={18}>{subscription.enabled ? "pause" : "play_arrow"}</MaterialIcon>
							{subscription.enabled ? "Disable" : "Enable"}
						</button>
						<button className="text-button" disabled={busy} type="button" onClick={() => setDialog("edit")}>
							<MaterialIcon size={18}>edit</MaterialIcon> Edit
						</button>
						<button className="text-button" disabled={busy} type="button" onClick={() => setDialog("rotate")}>
							<MaterialIcon size={18}>key</MaterialIcon> Rotate secret
						</button>
						<button className="text-button danger-text" disabled={busy} type="button" onClick={() => setDialog("delete")}>
							<MaterialIcon size={18}>delete</MaterialIcon> Delete
						</button>
					</div>
				)}
			</header>
			{subscription.disabledReason === "AUTO_FAILURES" && (
				<ErrorBanner
					message="Disabled after 5 consecutive dead-lettered deliveries. Fix the endpoint, then enable it to resume held deliveries."
					tone="warning"
				/>
			)}
			{failure && <ErrorBanner message={failure} />}
			<DeliveryList canManage={canManage} epoch={epoch} projectKey={project.key} subscriptionId={id} />
			{dialog === "edit" && (
				<WebhookFormDialog
					initial={subscription}
					projectKey={project.key}
					sinkUrl=""
					onClose={() => setDialog(null)}
					onSaved={async (saved) => {
						setDialog(null);
						await reload();
						notify({ kind: "success", message: `Webhook "${saved.name}" saved.` });
					}}
				/>
			)}
			{dialog === "rotate" && (
				<ConfirmationDialog
					busy={busy}
					confirmLabel="Rotate secret"
					message="Deliveries signed after this point use the new secret; the receiver must be updated before it can verify them."
					title="Rotate the signing secret?"
					onCancel={() => setDialog(null)}
					onConfirm={async () => {
						const updated = await run(() => webhookApi.update(id, { rotateSecret: true }, project.key), "Secret rotated.");
						setDialog(updated?.secret ? { secret: updated.secret } : null);
					}}
				/>
			)}
			{dialog?.secret &&
				createPortal(
					<Modal className="webhook-dialog" labelledBy="webhook-secret-title" onClose={() => setDialog(null)}>
						<div className="dialog-form">
							<header className="dialog-header">
								<h2 id="webhook-secret-title">New secret</h2>
							</header>
							<div className="dialog-body">
								<SecretReveal secret={dialog.secret} onDone={() => setDialog(null)} />
							</div>
						</div>
					</Modal>,
					document.body,
				)}
			{dialog === "delete" && (
				<ConfirmationDialog
					busy={busy}
					confirmLabel="Delete webhook"
					message={`Delete "${subscription.name}" and its delivery history? Receivers keep whatever they already stored.`}
					title="Delete webhook"
					onCancel={() => setDialog(null)}
					onConfirm={async () => {
						setBusy(true);
						try {
							await webhookApi.remove(id, project.key);
							notify({ kind: "success", message: `Webhook "${subscription.name}" deleted.` });
							reloadBadges?.();
							navigate(settingsPath);
						} catch (caught) {
							setFailure(caught.message);
							setDialog(null);
						} finally {
							setBusy(false);
						}
					}}
				/>
			)}
		</section>
	);
}
