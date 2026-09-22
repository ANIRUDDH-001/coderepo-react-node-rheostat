import { Badge } from "../../shared/components/Badge.jsx";
import { EmptyState } from "../../shared/components/EmptyState.jsx";
import { ErrorBanner } from "../../shared/components/ErrorBanner.jsx";
import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { Skeleton } from "../../shared/components/Skeleton.jsx";
import { useAsync } from "../../shared/hooks/useAsync.js";
import { formatDateTime, relativeTime } from "../../shared/utils/date.js";
import { webhookApi } from "./webhook.api.js";

const pretty = (body) => {
	try {
		return JSON.stringify(JSON.parse(body), null, 2);
	} catch {
		return body;
	}
};

// What the built-in receiver stored for this project, newest first. `epoch` forces a reload after "Clear inbox".
export function Inbox({ projectKey, epoch = 0 }) {
	const { data, error, loading, reload } = useAsync(() => webhookApi.receipts(projectKey), [projectKey, epoch]);
	return (
		<div className="inbox">
			<div className="editor-section-header inbox-header">
				<h3 id="inbox-title">Inbox</h3>
				<span className="muted">What the built-in receiver stored, newest first.</span>
				<button className="text-button" disabled={loading} type="button" onClick={reload}>
					<MaterialIcon size={18}>refresh</MaterialIcon> Refresh
				</button>
			</div>
			{error && <ErrorBanner message={error.message} requestId={error.status >= 500 ? error.requestId : ""} onRetry={reload} />}
			{loading && !data && <Skeleton rows={3} />}
			{data && !data.length && (
				<EmptyState description="Send a test from a webhook that points at the receiver." icon="inbox" title="The test receiver has not received anything yet." />
			)}
			{data && data.length > 0 && (
				<ul aria-labelledby="inbox-title" className="inbox-list">
					{data.map((receipt) => (
						<li className="inbox-row" key={receipt._id}>
							<div className="inbox-row-main">
								<code>{receipt.event}</code>
								{receipt.signatureValid ? (
									<Badge icon="check_circle" tone="success">
										Valid
									</Badge>
								) : (
									<Badge icon="error" tone="danger">
										Invalid: {receipt.signatureError}
									</Badge>
								)}
								{receipt.receivedCount > 1 && (
									<Badge title={`Received ${receipt.receivedCount} times — the sender retried; deduplicated by delivery id`} tone="warning">
										×{receipt.receivedCount}
									</Badge>
								)}
								<time className="muted" dateTime={receipt.lastReceivedAt} title={formatDateTime(receipt.lastReceivedAt)}>
									{relativeTime(receipt.lastReceivedAt)}
								</time>
							</div>
							<details className="inbox-body">
								<summary>Body · delivery {receipt.deliveryId}</summary>
								<pre className="delivery-payload">{pretty(receipt.body)}</pre>
							</details>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
