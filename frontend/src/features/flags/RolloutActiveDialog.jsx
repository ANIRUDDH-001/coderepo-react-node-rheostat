import { ConfirmationDialog } from "../../shared/components/ConfirmationDialog.jsx";

// Shared by direct saves, promotion, rollback, and change-request apply: confirm stalling an active rollout.
export function RolloutActiveDialog({ busy, environmentName, error, onCancel, onConfirm }) {
	const percent = error?.details?.currentPercent ?? 0;
	return (
		<ConfirmationDialog
			busy={busy}
			confirmLabel="Save anyway"
			message={`A rollout to ${percent}% is active in ${environmentName}. Saving will stall it until an operator resumes or aborts it.`}
			onCancel={onCancel}
			onConfirm={onConfirm}
			title="A rollout is active"
		/>
	);
}
