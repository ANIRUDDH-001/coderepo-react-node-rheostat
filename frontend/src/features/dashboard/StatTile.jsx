import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { Link } from "../../shared/router/Link.jsx";

// A headline number with its label. `tone` colors the icon only; the number always wears ink.
export function StatTile({ icon, label, to = null, tone = "neutral", value }) {
	const body = (
		<>
			<span className={`stat-tile-icon stat-tile-${tone}`} aria-hidden="true">
				<MaterialIcon size={20}>{icon}</MaterialIcon>
			</span>
			<span className="stat-tile-value">{value}</span>
			<span className="stat-tile-label">{label}</span>
		</>
	);
	if (to) {
		return (
			<Link className="stat-tile stat-tile-link" to={to}>
				{body}
			</Link>
		);
	}
	return <div className="stat-tile">{body}</div>;
}
