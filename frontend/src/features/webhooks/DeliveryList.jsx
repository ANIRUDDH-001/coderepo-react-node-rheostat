import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "../../shared/components/EmptyState.jsx";
import { ErrorBanner } from "../../shared/components/ErrorBanner.jsx";
import { SelectMenu } from "../../shared/components/SelectMenu.jsx";
import { Skeleton } from "../../shared/components/Skeleton.jsx";
import { useRoute } from "../../shared/router/router.js";
import { formatDateTime, relativeTime } from "../../shared/utils/date.js";
import { describeAttempt } from "./delivery-text.js";
import { DeliveryDrawer } from "./DeliveryDrawer.jsx";
import { DeliveryStatusBadge } from "./StatusBadge.jsx";
import { webhookApi } from "./webhook.api.js";

const STATUS_OPTIONS = [
	{ value: "", label: "Any status" },
	{ value: "delivered", label: "Delivered" },
	{ value: "pending", label: "Retrying" },
	{ value: "held", label: "Held" },
	{ value: "dead", label: "Dead-lettered" },
];

// Cursor-paged delivery history for one subscription; `epoch` reloads the first page after an action elsewhere.
export function DeliveryList({ subscriptionId, canManage, projectKey, epoch = 0 }) {
	const { query, setQuery } = useRoute();
	const status = STATUS_OPTIONS.some((option) => option.value === query.status) ? query.status : "";
	const [state, setState] = useState({ items: [], nextCursor: null, loading: true, error: null });
	const [open, setOpen] = useState("");
	const [reloads, setReloads] = useState(0);

	const load = useCallback(
		async (cursor) => {
			setState((current) => ({ ...current, loading: true, error: null }));
			try {
				const page = await webhookApi.deliveries(subscriptionId, { status, cursor: cursor || "" });
				setState((current) => ({
					items: cursor ? [...current.items, ...page.items] : page.items,
					nextCursor: page.nextCursor,
					loading: false,
					error: null,
				}));
			} catch (error) {
				setState((current) => ({ ...current, loading: false, error }));
			}
		},
		[subscriptionId, status],
	);
	useEffect(() => {
		load(null);
	}, [load, epoch, reloads]);

	return (
		<section className="editor-section" aria-labelledby="deliveries-title">
			<div className="editor-section-header">
				<h3 id="deliveries-title">Deliveries</h3>
				<SelectMenu
					ariaLabel="Delivery status"
					onChange={(value) => setQuery({ status: value })}
					options={STATUS_OPTIONS}
					value={status}
				/>
			</div>
			{state.error && (
				<ErrorBanner
					message={state.error.message}
					requestId={state.error.status >= 500 ? state.error.requestId : ""}
					onRetry={() => load(null)}
				/>
			)}
			{state.loading && !state.items.length && !state.error && <Skeleton rows={4} />}
			{!state.loading && !state.items.length && !state.error && (
				<EmptyState
					description={status ? "Nothing matches this status." : "Send a test to see the first delivery here."}
					icon="send"
					title="No deliveries yet"
				/>
			)}
			{state.items.length > 0 && (
				<div className="table-scroll">
					<table className="data-table delivery-table">
						<thead>
							<tr>
								<th>Event</th>
								<th>Status</th>
								<th className="numeric-cell">Attempts</th>
								<th>Last attempt</th>
								<th>Created</th>
							</tr>
						</thead>
						<tbody>
							{state.items.map((delivery) => (
								<tr key={delivery._id} onClick={() => setOpen(delivery._id)}>
									<td>
										<button className="row-button" type="button" onClick={() => setOpen(delivery._id)}>
											<code>{delivery.event}</code>
										</button>
									</td>
									<td>
										<DeliveryStatusBadge status={delivery.status} />
									</td>
									<td className="numeric-cell">{delivery.attempts.length}</td>
									<td>{describeAttempt(delivery.lastAttempt)}</td>
									<td>
										<time dateTime={delivery.createdAt} title={formatDateTime(delivery.createdAt)}>
											{relativeTime(delivery.createdAt)}
										</time>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			{state.nextCursor && (
				<div className="load-more">
					<button className="tonal-button" disabled={state.loading} type="button" onClick={() => load(state.nextCursor)}>
						{state.loading ? "Loading…" : "Load more"}
					</button>
				</div>
			)}
			{open && (
				<DeliveryDrawer
					canManage={canManage}
					deliveryId={open}
					projectKey={projectKey}
					onChanged={() => setReloads((value) => value + 1)}
					onClose={() => setOpen("")}
				/>
			)}
		</section>
	);
}
