import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { ErrorBanner } from "../../shared/components/ErrorBanner.jsx";
import { FormField } from "../../shared/components/FormField.jsx";
import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { Modal } from "../../shared/components/Modal.jsx";
import { useProject } from "../../shared/context/ProjectContext.jsx";
import { fieldErrors } from "../../shared/utils/format.js";
import { EventPicker } from "./EventPicker.jsx";
import { SecretReveal } from "./SecretReveal.jsx";
import { webhookApi } from "./webhook.api.js";

const urlProblem = (value) => {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:" ? "" : "Enter an absolute http(s) URL.";
	} catch {
		return "Enter an absolute http(s) URL.";
	}
};

// Create (initial = null) or edit a subscription. On create the body becomes the one-time secret reveal.
export function WebhookFormDialog({ initial, projectKey, sinkUrl, onClose, onSaved }) {
	const { project } = useProject();
	const titleId = `webhook-form-${useId().replace(/:/g, "")}`;
	const [name, setName] = useState(initial?.name || "");
	const [url, setUrl] = useState(initial?.url || "");
	const [events, setEvents] = useState(initial?.events || []);
	const [environments, setEnvironments] = useState(initial?.environments || []);
	const [errors, setErrors] = useState({ fields: {}, general: [], message: "" });
	const [busy, setBusy] = useState(false);
	const [created, setCreated] = useState(null);

	const toggleEnvironment = (key) =>
		setEnvironments((current) => (current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]));

	const submit = async (event) => {
		event.preventDefault();
		const fields = {};
		const urlError = urlProblem(url.trim());
		if (urlError) fields.url = urlError;
		if (!events.length) fields.events = "Choose at least one event.";
		if (Object.keys(fields).length) {
			setErrors({ fields, general: [], message: "" });
			return;
		}
		setBusy(true);
		setErrors({ fields: {}, general: [], message: "" });
		const input = { name: name.trim(), url: url.trim(), events, environments };
		try {
			if (initial) {
				onSaved(await webhookApi.update(initial._id, input, projectKey));
			} else {
				const result = await webhookApi.create(projectKey, input);
				setCreated(result);
			}
		} catch (caught) {
			setErrors(fieldErrors(caught));
		} finally {
			setBusy(false);
		}
	};

	return createPortal(
		<Modal className="webhook-dialog" labelledBy={titleId} onClose={created ? () => onSaved(created) : onClose}>
			{created ? (
				<div className="dialog-form">
					<header className="dialog-header">
						<h2 id={titleId}>Webhook created</h2>
					</header>
					<div className="dialog-body">
						<SecretReveal secret={created.secret} onDone={() => onSaved(created)} />
					</div>
				</div>
			) : (
				<form className="dialog-form" onSubmit={submit}>
					<header className="dialog-header">
						<h2 id={titleId}>{initial ? "Edit webhook" : "New webhook"}</h2>
						<button aria-label="Close" className="icon-button" disabled={busy} type="button" onClick={onClose}>
							<MaterialIcon size={22}>close</MaterialIcon>
						</button>
					</header>
					<div className="dialog-body">
						{errors.message && !Object.keys(errors.fields).length && (
							<ErrorBanner message={errors.message} requestId={errors.status >= 500 ? errors.requestId : ""} />
						)}
						<FormField error={errors.fields.name} label="Name" required>
							{(props) => (
								<input
									{...props}
									data-autofocus
									maxLength={80}
									required
									type="text"
									value={name}
									onChange={(event) => setName(event.target.value)}
								/>
							)}
						</FormField>
						<FormField error={errors.fields.url} hint="Rheostat POSTs a signed JSON body to this address." label="URL" required>
							{(props) => (
								<input
									{...props}
									inputMode="url"
									maxLength={500}
									placeholder="https://example.com/hooks/rheostat"
									required
									type="text"
									value={url}
									onChange={(event) => setUrl(event.target.value)}
								/>
							)}
						</FormField>
						<button className="text-button webhook-use-sink" disabled={!sinkUrl} type="button" onClick={() => setUrl(sinkUrl)}>
							<MaterialIcon size={18}>inbox</MaterialIcon> Use the built-in test receiver
						</button>
						{/* Group controls are labeled by their own heading rather than a <label for>. */}
						<div className={`form-field ${errors.fields.events ? "form-field-invalid" : ""}`}>
							<span className="form-field-heading" id={`${titleId}-events`}>
								Events<span aria-hidden="true"> *</span>
							</span>
							<div aria-labelledby={`${titleId}-events`} role="group">
								<EventPicker disabled={busy} onChange={setEvents} value={events} />
							</div>
							{errors.fields.events && (
								<span className="form-error" role="alert">
									{errors.fields.events}
								</span>
							)}
						</div>
						<div className="form-field">
							<span className="form-field-heading" id={`${titleId}-environments`}>
								Environments
							</span>
							<div aria-labelledby={`${titleId}-environments`} className="env-toggle-row" role="group">
								{project.environments.map((environment) => (
									<button
										aria-pressed={environments.includes(environment.key)}
										className="env-toggle"
										disabled={busy}
										key={environment.key}
										type="button"
										onClick={() => toggleEnvironment(environment.key)}
									>
										{environments.includes(environment.key) && <MaterialIcon size={16}>check</MaterialIcon>}
										{environment.name}
									</button>
								))}
							</div>
							<span className="form-hint">
								{environments.length
									? "Events that carry an environment are sent only for the selected ones."
									: "None selected: events for every environment are sent."}
							</span>
						</div>
					</div>
					<footer className="dialog-footer">
						<button className="text-button" disabled={busy} type="button" onClick={onClose}>
							Cancel
						</button>
						<button className="primary-button" disabled={busy || !name.trim() || !url.trim()} type="submit">
							{busy ? "Saving…" : initial ? "Save changes" : "Create webhook"}
						</button>
					</footer>
				</form>
			)}
		</Modal>,
		document.body,
	);
}
