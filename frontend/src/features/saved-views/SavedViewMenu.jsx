import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { ConfirmationDialog } from "../../shared/components/ConfirmationDialog.jsx";
import { FormField } from "../../shared/components/FormField.jsx";
import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { Modal } from "../../shared/components/Modal.jsx";
import { useToast } from "../../shared/components/Toast.jsx";
import { useAsync } from "../../shared/hooks/useAsync.js";
import { filtersToView, savedViewApi, viewToFilters } from "./saved-view.api.js";

const duplicateMessage = (error) =>
	error?.code === "DUPLICATE_KEY" ? "You already have a view with this name in this project." : error?.message || "";

function NameDialog({ busy, error, initial = "", onClose, onSubmit, title }) {
	const titleId = `saved-view-${useId().replace(/:/g, "")}`;
	const [name, setName] = useState(initial);
	return createPortal(
		<Modal className="saved-view-dialog" labelledBy={titleId} onClose={onClose}>
			<form
				className="dialog-form"
				onSubmit={(event) => {
					event.preventDefault();
					if (name.trim()) onSubmit(name.trim());
				}}
			>
				<header className="dialog-header">
					<h2 id={titleId}>{title}</h2>
					<button aria-label="Close" className="icon-button" disabled={busy} type="button" onClick={onClose}>
						<MaterialIcon size={22}>close</MaterialIcon>
					</button>
				</header>
				<div className="dialog-body">
					<FormField error={error} hint="Shown as a chip above the flags list. Only you can see it." label="View name" required>
						{(props) => (
							<input {...props} data-autofocus maxLength={60} required type="text" value={name} onChange={(event) => setName(event.target.value)} />
						)}
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

// Chips for the current person's saved views. Applying one rewrites the URL filters; the active chip matches the URL.
export function SavedViewMenu({ filters, onApply, projectKey }) {
	const { notify } = useToast();
	const { data, error, loading, reload } = useAsync(() => savedViewApi.list(projectKey), [projectKey]);
	const [dialog, setDialog] = useState(null);
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState("");
	const views = data || [];
	const current = JSON.stringify(filtersToView(filters)) + (filters.sort || "updated");
	const isActive = (view) => JSON.stringify(filtersToView(viewToFilters(view))) + (view.sort || "updated") === current;

	const run = async (action, message) => {
		setBusy(true);
		setFailure("");
		try {
			await action();
			await reload();
			setDialog(null);
			notify({ kind: "success", message });
		} catch (caught) {
			setFailure(duplicateMessage(caught));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="saved-views" role="group" aria-label="Saved views">
			<MaterialIcon size={18}>bookmarks</MaterialIcon>
			{loading && !data && <span className="muted">Loading views…</span>}
			{error && !data && (
				<button className="text-button" type="button" onClick={reload}>
					Could not load saved views. Retry
				</button>
			)}
			{data && views.length === 0 && <span className="muted">No saved views yet.</span>}
			{views.map((view) => {
				const active = isActive(view);
				return (
					<span className={active ? "saved-view-chip saved-view-chip-active" : "saved-view-chip"} key={view._id}>
						<button aria-pressed={active} type="button" onClick={() => onApply(viewToFilters(view))}>
							{view.name}
						</button>
						<button aria-label={`Rename ${view.name}`} type="button" onClick={() => setDialog({ kind: "rename", view })}>
							<MaterialIcon size={16}>edit</MaterialIcon>
						</button>
						<button aria-label={`Delete ${view.name}`} type="button" onClick={() => setDialog({ kind: "delete", view })}>
							<MaterialIcon size={16}>close</MaterialIcon>
						</button>
					</span>
				);
			})}
			<button className="text-button" type="button" onClick={() => setDialog({ kind: "create" })}>
				<MaterialIcon size={18}>bookmark_add</MaterialIcon> Save current filters
			</button>
			{dialog?.kind === "create" && (
				<NameDialog
					busy={busy}
					error={failure}
					onClose={() => setDialog(null)}
					onSubmit={(name) =>
						run(
							() => savedViewApi.create(projectKey, { name, filters: filtersToView(filters), sort: filters.sort || "updated" }),
							`View "${name}" saved.`,
						)
					}
					title="Save current filters"
				/>
			)}
			{dialog?.kind === "rename" && (
				<NameDialog
					busy={busy}
					error={failure}
					initial={dialog.view.name}
					onClose={() => setDialog(null)}
					onSubmit={(name) => run(() => savedViewApi.update(dialog.view._id, { name }), `View renamed to "${name}".`)}
					title="Rename view"
				/>
			)}
			{dialog?.kind === "delete" && (
				<ConfirmationDialog
					busy={busy}
					confirmLabel="Delete view"
					error={failure}
					message={`"${dialog.view.name}" is removed from your saved views. The flags themselves are not affected.`}
					onCancel={() => setDialog(null)}
					onConfirm={() => run(() => savedViewApi.remove(dialog.view._id), "View deleted.")}
					title="Delete this view?"
				/>
			)}
		</div>
	);
}
