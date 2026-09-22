import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { ErrorBanner } from "../../shared/components/ErrorBanner.jsx";
import { FormField } from "../../shared/components/FormField.jsx";
import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { Modal } from "../../shared/components/Modal.jsx";
import { fieldErrors, keyError, slugify } from "../../shared/utils/format.js";
import { projectApi } from "./project.api.js";

export function ProjectCreateDialog({ onClose, onCreated }) {
	const titleId = `create-project-${useId().replace(/:/g, "")}`;
	const [name, setName] = useState("");
	const [key, setKey] = useState("");
	const [keyTouched, setKeyTouched] = useState(false);
	const [description, setDescription] = useState("");
	const [errors, setErrors] = useState({ fields: {}, general: [], message: "" });
	const [busy, setBusy] = useState(false);

	const submit = async (event) => {
		event.preventDefault();
		const keyProblem = keyError(key.trim());
		if (keyProblem) {
			setErrors({ fields: { key: keyProblem }, general: [], message: "" });
			return;
		}
		setBusy(true);
		setErrors({ fields: {}, general: [], message: "" });
		try {
			const project = await projectApi.create({ key: key.trim(), name: name.trim(), description: description.trim() });
			onCreated(project);
		} catch (caught) {
			const parsed = fieldErrors(caught);
			if (caught.code === "DUPLICATE_KEY") parsed.fields.key = "A project with this key already exists.";
			setErrors(parsed);
		} finally {
			setBusy(false);
		}
	};

	return createPortal(
		<Modal className="project-dialog" labelledBy={titleId} onClose={onClose}>
			<form className="dialog-form" onSubmit={submit}>
				<header className="dialog-header">
					<h2 id={titleId}>Create project</h2>
					<button aria-label="Close" className="icon-button" disabled={busy} type="button" onClick={onClose}>
						<MaterialIcon size={22}>close</MaterialIcon>
					</button>
				</header>
				<div className="dialog-body">
					{errors.message && !Object.keys(errors.fields).length && <ErrorBanner message={errors.message} />}
					<FormField error={errors.fields.name} label="Name" required>
						{(props) => (
							<input
								{...props}
								data-autofocus
								maxLength={80}
								required
								type="text"
								value={name}
								onChange={(event) => {
									setName(event.target.value);
									if (!keyTouched) setKey(slugify(event.target.value));
								}}
							/>
						)}
					</FormField>
					<FormField error={errors.fields.key} hint="Used in URLs and SDK calls. Cannot be changed later." label="Key" required>
						{(props) => (
							<input
								{...props}
								maxLength={40}
								required
								type="text"
								value={key}
								onChange={(event) => {
									setKeyTouched(true);
									setKey(event.target.value.toLowerCase());
								}}
							/>
						)}
					</FormField>
					<FormField error={errors.fields.description} label="Description">
						{(props) => (
							<textarea {...props} maxLength={500} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
						)}
					</FormField>
					<p className="muted">
						New projects start with Development, Staging, and Production; Production is protected with one required approval.
					</p>
				</div>
				<footer className="dialog-footer">
					<button className="text-button" disabled={busy} type="button" onClick={onClose}>
						Cancel
					</button>
					<button className="primary-button" disabled={busy || !name.trim() || !key.trim()} type="submit">
						{busy ? "Creating…" : "Create project"}
					</button>
				</footer>
			</form>
		</Modal>,
		document.body,
	);
}
