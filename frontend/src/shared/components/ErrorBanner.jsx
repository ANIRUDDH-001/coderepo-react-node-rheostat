import { MaterialIcon } from "./MaterialIcon.jsx";

export function ErrorBanner({ action = null, children = null, message, onRetry = null, requestId = "", tone = "danger" }) {
	return (
		<div className={`banner banner-${tone}`} role="alert">
			<MaterialIcon size={20}>{tone === "danger" ? "error_outline" : tone === "warning" ? "warning_amber" : "info"}</MaterialIcon>
			<div className="banner-body">
				<span>{message}</span>
				{requestId && <span className="error-reference">Reference: {requestId}</span>}
				{children}
			</div>
			{onRetry && (
				<button className="text-button" type="button" onClick={onRetry}>
					Retry
				</button>
			)}
			{action}
		</div>
	);
}
