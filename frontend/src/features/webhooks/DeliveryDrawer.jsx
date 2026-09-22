import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { ErrorBanner } from "../../shared/components/ErrorBanner.jsx";
import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { Modal } from "../../shared/components/Modal.jsx";
import { Skeleton } from "../../shared/components/Skeleton.jsx";
import { useToast } from "../../shared/components/Toast.jsx";
import { formatDateTime, relativeTime } from "../../shared/utils/date.js";
import { AttemptTimeline } from "./AttemptTimeline.jsx";
import { DeliveryStatusBadge } from "./StatusBadge.jsx";
import { webhookApi } from "./webhook.api.js";

const secondsUntil = (value) => Math.max(0, Math.round((new Date(value).getTime() - Date.now()) / 1000));

// One delivery in full: attempts, headers, payload, and the redeliver action. `onChanged` lets the list refresh.
export function DeliveryDrawer({ deliveryId, canManage, projectKey, onClose, onChanged }) {
	const titleId = `delivery-${useId().replace(/:/g, "")}`;
	const { notify } = useToast();
	const [delivery, setDelivery] = useState(null);
	const [error, setError] = useState(null);
	const [sending, setSending] = useState(false);

	useEffect(() => {
		let active = true;
		setDelivery(null);
		setError(null);
		webhookApi
			.delivery(deliveryId)
			.then((loaded) => active && setDelivery(loaded))
			.catch((caught) => active && setError(caught));
		return () => {
			active = false;
		};
	}, [deliveryId]);

	const redeliver = async () => {
		setSending(true);
		try {
			const updated = await webhookApi.redeliver(deliveryId, projectKey);
			setDelivery(updated);
			notify(
				updated.status === "delivered"
					? { kind: "success", message: "Delivered." }
					: {
							kind: "error",
							message: updated.nextAttemptAt
								? `Failed — next attempt in ${secondsUntil(updated.nextAttemptAt)} s.`
								: "Failed — dead-lettered.",
						},
			);
			onChanged?.();
		} catch (caught) {
			notify({ kind: "error", message: caught.message });
		} finally {
			setSending(false);
		}
	};
	const blocked = delivery && (delivery.status === "delivering" || delivery.status === "held");
	const blockedReason =
		delivery?.status === "held" ? "Held deliveries resume when the webhook is enabled." : "A delivery in flight cannot be requeued.";

	return createPortal(
		<Modal className="delivery-drawer" labelledBy={titleId} onClose={onClose}>
			<div className="dialog-form">
				<header className="dialog-header">
					<h2 id={titleId}>{delivery ? `Delivery · ${delivery.event}` : "Delivery"}</h2>
					<button aria-label="Close" className="icon-button" type="button" onClick={onClose}>
						<MaterialIcon size={22}>close</MaterialIcon>
					</button>
				</header>
				<div className="dialog-body">
					{error && <ErrorBanner message={error.message} requestId={error.status >= 500 ? error.requestId : ""} />}
					{!delivery && !error && <Skeleton rows={6} />}
					{delivery && (
						<>
							<div className="drawer-summary">
								<DeliveryStatusBadge status={delivery.status} />
								<span className="muted">
									Created{" "}
									<time dateTime={delivery.createdAt} title={formatDateTime(delivery.createdAt)}>
										{relativeTime(delivery.createdAt)}
									</time>
								</span>
								{delivery.subscription && (
									<span className="muted">
										to <strong>{delivery.subscription.name}</strong>
									</span>
								)}
								<code className="muted">{delivery.eventId}</code>
							</div>
							<section className="drawer-section" aria-label="Attempts">
								<h4>Attempts</h4>
								<AttemptTimeline
									attempts={delivery.attempts}
									budgetFrom={delivery.budgetFrom}
									nextAttemptAt={delivery.nextAttemptAt}
									status={delivery.status}
								/>
							</section>
							<section className="drawer-section" aria-label="Request headers">
								<h4>Headers</h4>
								<table className="headers-table">
									<tbody>
										{Object.entries(delivery.headers || {}).map(([name, value]) => (
											<tr key={name}>
												<th scope="row">{name}</th>
												<td>
													<code>{value}</code>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</section>
							<section className="drawer-section" aria-label="Payload">
								<h4>Payload</h4>
								<pre className="delivery-payload">{JSON.stringify(delivery.payload, null, 2)}</pre>
							</section>
						</>
					)}
				</div>
				<footer className="dialog-footer">
					<button className="text-button" type="button" onClick={onClose}>
						Close
					</button>
					{canManage && delivery && (
						<button
							className="primary-button"
							disabled={sending || blocked}
							title={blocked ? blockedReason : "Requeue with a fresh retry budget and send now"}
							type="button"
							onClick={redeliver}
						>
							<MaterialIcon size={18}>autorenew</MaterialIcon> {sending ? "Sending…" : "Redeliver"}
						</button>
					)}
				</footer>
			</div>
		</Modal>,
		document.body,
	);
}
