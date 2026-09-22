import { Link } from "../../shared/router/Link.jsx";
import { buildPath } from "../../shared/router/match.js";

// One proportional bar per flag showing which variations were served. Hues follow variation order within a flag
// (never a global rank), and every segment is named in the list below it, so identity never rests on color alone.
const MAX_SLOTS = 4;

export function DistributionBars({ byFlag, projectKey }) {
	return (
		<ul className="distribution-list">
			{byFlag.map((entry) => {
				const slots = entry.variations.slice(0, MAX_SLOTS);
				const rest = entry.variations.slice(MAX_SLOTS).reduce((sum, variation) => sum + variation.count, 0);
				const segments = rest ? [...slots, { variationId: "other", name: "Other", count: rest }] : slots;
				return (
					<li className="distribution-row" key={entry.flagKey}>
						<div className="distribution-heading">
							<Link to={buildPath("flag", { projectKey, flagKey: entry.flagKey }, { env: "production" })}>{entry.flagKey}</Link>
							<span className="muted">{entry.total} evaluations</span>
						</div>
						<div
							className="distribution-bar"
							role="img"
							aria-label={segments.map((segment) => `${segment.name} ${Math.round((segment.count / entry.total) * 100)}%`).join(", ")}
						>
							{segments.map((segment, index) => (
								<span
									className={`distribution-segment chart-series-${Math.min(index + 1, MAX_SLOTS + 1)}`}
									key={segment.variationId}
									style={{ flexGrow: segment.count }}
									title={`${segment.name}: ${segment.count}`}
								/>
							))}
						</div>
						<div className="distribution-legend">
							{segments.map((segment, index) => (
								<span className="chart-legend-item" key={segment.variationId}>
									<i className={`chart-swatch chart-series-${Math.min(index + 1, MAX_SLOTS + 1)}`} />
									{segment.name} <span className="muted">{Math.round((segment.count / entry.total) * 100)}%</span>
								</span>
							))}
						</div>
					</li>
				);
			})}
		</ul>
	);
}
