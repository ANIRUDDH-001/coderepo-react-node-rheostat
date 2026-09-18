import { MaterialIcon } from "./MaterialIcon.jsx";

export function EmptyState({ action = null, description = "", icon = "info", title }) {
	return (
		<div className="empty-state">
			<span className="empty-state-icon">
				<MaterialIcon size={40}>{icon}</MaterialIcon>
			</span>
			<h2>{title}</h2>
			{description && <p>{description}</p>}
			{action && (
				<button type="button" onClick={action.onClick}>
					{action.label}
				</button>
			)}
		</div>
	);
}
