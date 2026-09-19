import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { ChipInput } from "../../shared/components/ChipInput.jsx";
import { FormField } from "../../shared/components/FormField.jsx";
import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { Modal } from "../../shared/components/Modal.jsx";
import { SelectMenu } from "../../shared/components/SelectMenu.jsx";
import { useSession } from "../../shared/context/SessionContext.jsx";
import { fieldErrors, slugify } from "../../shared/utils/format.js";
import { PersonPicker } from "../people/PersonPicker.jsx";
import { flagApi } from "./flag.api.js";
import { serializeVariations, VariationsEditor } from "./VariationsEditor.jsx";

const TYPE_OPTIONS = [
	{ value: "boolean", label: "Boolean" },
	{ value: "string", label: "String" },
	{ value: "number", label: "Number" },
	{ value: "json", label: "JSON" },
];
const DEFAULT_ROWS = {
	boolean: [
		{ id: "v_true", name: "True", value: true, existing: false },
		{ id: "v_false", name: "False", value: false, existing: false },
	],
	string: [
		{ name: "Control", value: "control", existing: false },
		{ name: "Treatment", value: "treatment", existing: false },
	],
	number: [
		{ name: "Default", value: 10, existing: false },
		{ name: "Alternative", value: 20, existing: false },
	],
	json: [
		{ name: "Default", value: "{}", existing: false },
		{ name: "Alternative", value: '{"enabled": true}', existing: false },
	],
};

export function FlagCreateDialog({ onClose, onCreated, projectKey }) {
	const { profile } = useSession();
	const titleId = `create-flag-${useId().replace(/:/g, "")}`;
	const [name, setName] = useState("");
	const [key, setKey] = useState("");
	const [keyTouched, setKeyTouched] = useState(false);
	const [description, setDescription] = useState("");
	const [type, setType] = useState("boolean");
	const [rows, setRows] = useState(DEFAULT_ROWS.boolean);
	const [tags, setTags] = useState([]);
	const [ownerId, setOwnerId] = useState(profile._id);
	const [lifecycle, setLifecycle] = useState("temporary");
	const [removeBy, setRemoveBy] = useState("");
	const [errors, setErrors] = useState({ fields: {}, general: [], variations: {} });
	const [busy, setBusy] = useState(false);

	const submit = async (event) => {
		event.preventDefault();
		const { variations, errors: variationErrors } = serializeVariations(rows, type);
		if (Object.keys(variationErrors).length) {
			setErrors({ fields: {}, general: [], variations: variationErrors });
			return;
		}
		setBusy(true);
		try {
			const created = await flagApi.create(projectKey, {
				key: key.trim(),
				name: name.trim(),
				description: description.trim(),
				type,
				variations: type === "boolean" ? [] : variations,
				tags,
				...(ownerId ? { ownerId } : {}),
				lifecycle: { kind: lifecycle, removeBy: lifecycle === "temporary" && removeBy ? removeBy : null },
			});
			onCreated(created);
		} catch (error) {
			const parsed = fieldErrors(error);
			if (error.code === "DUPLICATE_KEY") parsed.fields.key = "A flag with this key already exists in the project.";
			setErrors({ ...parsed, variations: {} });
		} finally {
			setBusy(false);
		}
	};

	return createPortal(
		<Modal className="form-dialog" labelledBy={titleId} onClose={() => !busy && onClose()}>
			<form className="dialog-form" onSubmit={submit}>
				<header className="dialog-header">
					<h2 id={titleId}>Create flag</h2>
					<button aria-label="Close" className="icon-button" disabled={busy} type="button" onClick={onClose}>
						<MaterialIcon>close</MaterialIcon>
					</button>
				</header>
				<div className="dialog-body">
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
					<FormField error={errors.fields.name} label="Name" required>
						{(props) => (
							<input
								{...props}
								data-autofocus
								maxLength={120}
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
					<FormField error={errors.fields.key} hint="Lowercase letters, numbers, and hyphens. Cannot be changed later." label="Key" required>
						{(props) => (
							<input
								{...props}
								maxLength={40}
								pattern="[a-z][a-z0-9-]{1,39}"
								required
								spellCheck={false}
								type="text"
								value={key}
								onChange={(event) => {
									setKeyTouched(true);
									setKey(event.target.value);
								}}
							/>
						)}
					</FormField>
					<FormField error={errors.fields.description} label="Description">
						{(props) => <textarea {...props} maxLength={1000} rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />}
					</FormField>
					<div className="form-row">
						<FormField label="Type">
							{() => (
								<SelectMenu
									ariaLabel="Flag type"
									onChange={(next) => {
										setType(next);
										setRows(DEFAULT_ROWS[next]);
										setErrors((previous) => ({ ...previous, variations: {} }));
									}}
									options={TYPE_OPTIONS}
									value={type}
								/>
							)}
						</FormField>
						<FormField label="Owner">{() => <PersonPicker ariaLabel="Owner" onChange={setOwnerId} value={ownerId} />}</FormField>
					</div>
					<FormField error={errors.fields.variations} label="Variations">
						{() => <VariationsEditor errors={errors.variations} onChange={setRows} rows={rows} type={type} />}
					</FormField>
					<FormField error={errors.fields.tags} hint="Up to 10 tags. Press Enter to add." label="Tags">
						{(props) => <ChipInput {...props} max={10} normalize={(value) => value.trim().toLowerCase().slice(0, 30)} placeholder="checkout, experiment…" values={tags} onChange={setTags} />}
					</FormField>
					<div className="form-row">
						<FormField label="Lifecycle">
							{() => (
								<SelectMenu
									ariaLabel="Lifecycle"
									onChange={setLifecycle}
									options={[
										{ value: "temporary", label: "Temporary (remove after rollout)" },
										{ value: "permanent", label: "Permanent (operational)" },
									]}
									value={lifecycle}
								/>
							)}
						</FormField>
						{lifecycle === "temporary" && (
							<FormField error={errors.fields.lifecycle} hint="Optional. Flags past this date show as overdue." label="Remove by">
								{(props) => <input {...props} type="date" value={removeBy} onChange={(event) => setRemoveBy(event.target.value)} />}
							</FormField>
						)}
					</div>
				</div>
				<footer className="dialog-footer">
					<button className="text-button" disabled={busy} type="button" onClick={onClose}>
						Cancel
					</button>
					<button className="primary-button" disabled={busy || !name.trim() || !key.trim()} type="submit">
						{busy ? "Creating…" : "Create flag"}
					</button>
				</footer>
			</form>
		</Modal>,
		document.body,
	);
}
