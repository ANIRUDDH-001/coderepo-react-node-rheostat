import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { FormField } from "../../shared/components/FormField.jsx";
import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { Modal } from "../../shared/components/Modal.jsx";

const MIN_REASON = 10;

export function KillSwitchDialog({ flag, onClose, onConfirm }) {
	const titleId = `kill-switch-${useId().replace(/:/g, "")}`;
	const [reason, setReason] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const submit = async (event) => {
		event.preventDefault();
		if (reason.trim().length < MIN_REASON) {
			setError(`Give at least ${MIN_REASON} characters so the history explains the outage.`);
			return;
		}
		setBusy(true);
		try {
			await onConfirm(reason.trim());
		} catch (failure) {
			setError(failure.details?.fieldErrors?.reason?.[0] || failure.message);
			setBusy(false);
		}
	};
	return createPortal(
		<Modal className="form-dialog form-dialog-narrow" labelledBy={titleId} onClose={() => !busy && onClose()}>
			<form className="dialog-form" onSubmit={submit}>
				<header className="dialog-header">
					<h2 id={titleId}>Activate kill switch</h2>
					<button aria-label="Close" className="icon-button" disabled={busy} type="button" onClick={onClose}>
						<MaterialIcon>close</MaterialIcon>
					</button>
				</header>
				<div className="dialog-body">
					<p>
						Every environment of <strong>{flag.name}</strong> will serve its off variation immediately, regardless of rules or
						rollouts. Active rollouts hold until the switch is cleared.
					</p>
					<FormField error={error} hint="Recorded in the audit history." label="Reason" required>
						{(props) => (
							<textarea
								{...props}
								data-autofocus
								maxLength={300}
								rows={3}
								value={reason}
								onChange={(event) => setReason(event.target.value)}
							/>
						)}
					</FormField>
				</div>
				<footer className="dialog-footer">
					<button className="text-button" disabled={busy} type="button" onClick={onClose}>
						Cancel
					</button>
					<button className="danger-button" disabled={busy} type="submit">
						{busy ? "Activating…" : "Activate kill switch"}
					</button>
				</footer>
			</form>
		</Modal>,
		document.body,
	);
}
