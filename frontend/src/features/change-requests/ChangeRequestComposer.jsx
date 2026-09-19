import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { FormField } from "../../shared/components/FormField.jsx";
import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { Modal } from "../../shared/components/Modal.jsx";
import { fieldErrors } from "../../shared/utils/format.js";

// Title/description for a proposal; the caller submits (create or edit) and handles navigation.
export function ChangeRequestComposer({ environmentName, flagName, initialDescription = "", initialTitle = "", onClose, onSubmit, submitLabel = "Propose change" }) {
	const titleId = `composer-${useId().replace(/:/g, "")}`;
	const [title, setTitle] = useState(initialTitle);
	const [description, setDescription] = useState(initialDescription);
	const [errors, setErrors] = useState({ fields: {}, general: [] });
	const [busy, setBusy] = useState(false);
	const submit = async (event) => {
		event.preventDefault();
		if (title.trim().length < 3) {
			setErrors({ fields: { title: "Give the proposal a title of at least 3 characters." }, general: [] });
			return;
		}
		setBusy(true);
		try {
			await onSubmit({ title: title.trim(), description: description.trim() });
		} catch (error) {
			const parsed = fieldErrors(error);
			if (!parsed.general.length && !Object.keys(parsed.fields).length) parsed.general = [error.message];
			setErrors(parsed);
			setBusy(false);
		}
	};
	return createPortal(
		<Modal className="form-dialog form-dialog-narrow" labelledBy={titleId} onClose={() => !busy && onClose()}>
			<form className="dialog-form" onSubmit={submit}>
				<header className="dialog-header">
					<h2 id={titleId}>Propose change to {environmentName}</h2>
					<button aria-label="Close" className="icon-button" disabled={busy} type="button" onClick={onClose}>
						<MaterialIcon>close</MaterialIcon>
					</button>
				</header>
				<div className="dialog-body">
					<p>
						{environmentName} is protected. Your targeting for <strong>{flagName}</strong> becomes a change request that a reviewer must approve before it can be applied.
					</p>
					{errors.general.length > 0 && (
						<div className="banner banner-danger" role="alert">
							<MaterialIcon size={20}>error_outline</MaterialIcon>
							<div className="banner-body">
								{errors.general.map((message) => (
									<span key={message}>{message}</span>
								))}
							</div>
						</div>
					)}
					<FormField error={errors.fields.title} label="Title" required>
						{(props) => <input {...props} data-autofocus maxLength={140} required type="text" value={title} onChange={(event) => setTitle(event.target.value)} />}
					</FormField>
					<FormField error={errors.fields.description} hint="What changes and why. Reviewers see this first." label="Description">
						{(props) => <textarea {...props} maxLength={2000} rows={4} value={description} onChange={(event) => setDescription(event.target.value)} />}
					</FormField>
				</div>
				<footer className="dialog-footer">
					<button className="text-button" disabled={busy} type="button" onClick={onClose}>
						Cancel
					</button>
					<button className="primary-button" disabled={busy || !title.trim()} type="submit">
						{busy ? "Submitting…" : submitLabel}
					</button>
				</footer>
			</form>
		</Modal>,
		document.body,
	);
}
