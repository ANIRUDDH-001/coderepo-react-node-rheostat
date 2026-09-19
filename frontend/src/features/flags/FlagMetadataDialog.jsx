import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { ChipInput } from "../../shared/components/ChipInput.jsx";
import { FormField } from "../../shared/components/FormField.jsx";
import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { Modal } from "../../shared/components/Modal.jsx";
import { SelectMenu } from "../../shared/components/SelectMenu.jsx";
import { toDateInput } from "../../shared/utils/date.js";
import { fieldErrors } from "../../shared/utils/format.js";
import { PersonPicker } from "../people/PersonPicker.jsx";
import { serializeVariations, VariationsEditor } from "./VariationsEditor.jsx";

export function FlagMetadataDialog({ flag, onClose, onSave }) {
	const titleId = `edit-flag-${useId().replace(/:/g, "")}`;
	const [name, setName] = useState(flag.name);
	const [description, setDescription] = useState(flag.description || "");
	const [tags, setTags] = useState(flag.tags);
	const [ownerId, setOwnerId] = useState(flag.ownerId || "");
	const [lifecycle, setLifecycle] = useState(flag.lifecycle.kind);
	const [removeBy, setRemoveBy] = useState(toDateInput(flag.lifecycle.removeBy));
	const [rows, setRows] = useState(flag.variations.map((variation) => ({ ...variation, existing: true })));
	const [errors, setErrors] = useState({ fields: {}, general: [], variations: {} });
	const [busy, setBusy] = useState(false);

	const submit = async (event) => {
		event.preventDefault();
		const patch = {};
		if (name.trim() !== flag.name) patch.name = name.trim();
		if (description.trim() !== (flag.description || "")) patch.description = description.trim();
		if (JSON.stringify(tags) !== JSON.stringify(flag.tags)) patch.tags = tags;
		if ((ownerId || null) !== (flag.ownerId || null)) patch.ownerId = ownerId || null;
		const nextRemoveBy = lifecycle === "temporary" && removeBy ? removeBy : null;
		const currentRemoveBy = toDateInput(flag.lifecycle.removeBy) || null;
		if (lifecycle !== flag.lifecycle.kind || nextRemoveBy !== currentRemoveBy) patch.lifecycle = { kind: lifecycle, removeBy: nextRemoveBy };
		if (flag.type !== "boolean") {
			const { variations, errors: variationErrors } = serializeVariations(rows, flag.type);
			if (Object.keys(variationErrors).length) {
				setErrors({ fields: {}, general: [], variations: variationErrors });
				return;
			}
			const changed = variations.length !== flag.variations.length || variations.some((variation, index) => variation.name !== flag.variations[index]?.name);
			if (changed) patch.variations = variations;
		}
		if (!Object.keys(patch).length) {
			onClose();
			return;
		}
		setBusy(true);
		try {
			await onSave(patch);
		} catch (error) {
			const parsed = fieldErrors(error);
			setErrors({ ...parsed, variations: {} });
			setBusy(false);
		}
	};

	return createPortal(
		<Modal className="form-dialog" labelledBy={titleId} onClose={() => !busy && onClose()}>
			<form className="dialog-form" onSubmit={submit}>
				<header className="dialog-header">
					<h2 id={titleId}>Edit flag</h2>
					<button aria-label="Close" className="icon-button" disabled={busy} type="button" onClick={onClose}>
						<MaterialIcon>close</MaterialIcon>
					</button>
				</header>
				<div className="dialog-body">
					{(errors.general.length > 0 || errors.message) && Object.keys(errors.fields).length === 0 && Object.keys(errors.variations).length === 0 && (
						<div className="banner banner-danger" role="alert">
							<MaterialIcon size={20}>error_outline</MaterialIcon>
							<div className="banner-body">{errors.general.length ? errors.general.map((message) => <span key={message}>{message}</span>) : <span>{errors.message}</span>}</div>
						</div>
					)}
					<FormField error={errors.fields.name} label="Name" required>
						{(props) => <input {...props} data-autofocus maxLength={120} required type="text" value={name} onChange={(event) => setName(event.target.value)} />}
					</FormField>
					<FormField hint={`Key ${flag.key} cannot change.`} label="Description">
						{(props) => <textarea {...props} maxLength={1000} rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />}
					</FormField>
					<FormField label="Owner">{() => <PersonPicker ariaLabel="Owner" onChange={setOwnerId} value={ownerId} />}</FormField>
					<FormField error={errors.fields.tags} label="Tags">
						{(props) => <ChipInput {...props} max={10} normalize={(value) => value.trim().toLowerCase().slice(0, 30)} values={tags} onChange={setTags} />}
					</FormField>
					<div className="form-row">
						<FormField label="Lifecycle">
							{() => (
								<SelectMenu
									ariaLabel="Lifecycle"
									onChange={setLifecycle}
									options={[
										{ value: "temporary", label: "Temporary" },
										{ value: "permanent", label: "Permanent" },
									]}
									value={lifecycle}
								/>
							)}
						</FormField>
						{lifecycle === "temporary" && (
							<FormField error={errors.fields.lifecycle} label="Remove by">
								{(props) => <input {...props} type="date" value={removeBy} onChange={(event) => setRemoveBy(event.target.value)} />}
							</FormField>
						)}
					</div>
					<FormField error={errors.fields.variations} hint={flag.type === "boolean" ? "" : "Existing variations can be renamed but never removed or revalued."} label="Variations">
						{() => <VariationsEditor errors={errors.variations} onChange={setRows} rows={rows} type={flag.type} />}
					</FormField>
				</div>
				<footer className="dialog-footer">
					<button className="text-button" disabled={busy} type="button" onClick={onClose}>
						Cancel
					</button>
					<button className="primary-button" disabled={busy || !name.trim()} type="submit">
						{busy ? "Saving…" : "Save"}
					</button>
				</footer>
			</form>
		</Modal>,
		document.body,
	);
}
