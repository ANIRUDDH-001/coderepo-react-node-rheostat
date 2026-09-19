import { MaterialIcon } from "./MaterialIcon.jsx";

// Small status chips: tone ∈ neutral | accent | success | warning | danger | info.
export function Badge({ children, className = "", icon = null, title, tone = "neutral" }) {
	return (
		<span className={`badge badge-${tone} ${className}`} title={title}>
			{icon && <MaterialIcon size={14}>{icon}</MaterialIcon>}
			{children}
		</span>
	);
}
