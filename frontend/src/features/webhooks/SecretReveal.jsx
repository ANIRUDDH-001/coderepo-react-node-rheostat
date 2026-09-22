import { ErrorBanner } from "../../shared/components/ErrorBanner.jsx";
import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { useToast } from "../../shared/components/Toast.jsx";

// Shown exactly once after create or rotate: the API never returns the secret again.
export function SecretReveal({ secret, onDone }) {
	const { notify } = useToast();
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(secret);
			notify({ kind: "success", message: "Secret copied." });
		} catch {
			notify({ kind: "error", message: "Could not copy — select the secret and copy it manually." });
		}
	};
	return (
		<div className="secret-reveal-body">
			<ErrorBanner message="This is the only time the secret is shown. Store it with the receiver." tone="warning" />
			<p className="muted">Signatures are HMAC-SHA256 over the timestamp and the exact request body, using this secret.</p>
			<div className="secret-reveal-row">
				<code aria-label="Webhook secret" className="secret-reveal">
					{secret}
				</code>
				<button className="tonal-button" type="button" onClick={copy}>
					<MaterialIcon size={18}>content_copy</MaterialIcon> Copy
				</button>
			</div>
			<footer className="dialog-footer">
				<button className="primary-button" data-autofocus type="button" onClick={onDone}>
					Done
				</button>
			</footer>
		</div>
	);
}
