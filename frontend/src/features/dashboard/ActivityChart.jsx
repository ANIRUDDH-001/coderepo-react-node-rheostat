import { useId, useState } from "react";

// Stacked daily bars for the last 14 days: simulated traffic below, playground runs on top.
// Series colors are theme tokens validated for both modes; identity is also carried by the legend and the table.
const SERIES = [
	{ key: "simulated", label: "Simulated traffic", className: "chart-series-1" },
	{ key: "playground", label: "Playground runs", className: "chart-series-2" },
];
const WIDTH = 720;
const HEIGHT = 200;
const PAD = { top: 12, right: 8, bottom: 28, left: 40 };
const GAP = 2;

const shortDay = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const weekday = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short" });

function niceMax(value) {
	if (value <= 10) return 10;
	const magnitude = 10 ** Math.floor(Math.log10(value));
	const scaled = value / magnitude;
	const step = scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
	return step * magnitude;
}

export function ActivityChart({ days }) {
	const id = useId().replace(/:/g, "");
	const [hovered, setHovered] = useState(null);
	const totals = days.map((day) => day.simulated + day.playground);
	const max = niceMax(Math.max(1, ...totals));
	const plotWidth = WIDTH - PAD.left - PAD.right;
	const plotHeight = HEIGHT - PAD.top - PAD.bottom;
	const slot = plotWidth / Math.max(1, days.length);
	const barWidth = Math.max(6, Math.min(28, slot - 8));
	const y = (value) => PAD.top + plotHeight - (value / max) * plotHeight;
	const ticks = [0, max / 2, max];
	const grandTotal = totals.reduce((sum, value) => sum + value, 0);
	const active = hovered === null ? null : days[hovered];

	return (
		<figure className="activity-chart" aria-labelledby={`${id}-title`} aria-describedby={`${id}-desc`}>
			<div className="chart-legend" aria-hidden="true">
				{SERIES.map((series) => (
					<span className="chart-legend-item" key={series.key}>
						<i className={`chart-swatch ${series.className}`} /> {series.label}
					</span>
				))}
			</div>
			<svg className="chart-svg" role="img" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} onMouseLeave={() => setHovered(null)}>
				<title id={`${id}-title`}>Evaluations per day, last 14 days</title>
				<desc id={`${id}-desc`}>
					{`${grandTotal} evaluations in total; the busiest day is ${
						days.length ? shortDay(days[totals.indexOf(Math.max(...totals))].date) : "none"
					}.`}
				</desc>
				{ticks.map((tick) => (
					<g key={tick}>
						<line className="chart-grid" x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} />
						<text className="chart-axis-label" x={PAD.left - 8} y={y(tick) + 4} textAnchor="end">
							{tick}
						</text>
					</g>
				))}
				{days.map((day, index) => {
					const x = PAD.left + index * slot + (slot - barWidth) / 2;
					const simulatedTop = y(day.simulated);
					const playgroundTop = y(day.simulated + day.playground);
					const baseline = y(0);
					return (
						<g
							className={hovered === index ? "chart-bar chart-bar-hover" : "chart-bar"}
							key={day.date}
							onMouseEnter={() => setHovered(index)}
							onFocus={() => setHovered(index)}
							onBlur={() => setHovered(null)}
							tabIndex={0}
						>
							<rect className="chart-hit" x={PAD.left + index * slot} y={PAD.top} width={slot} height={plotHeight} />
							{day.simulated > 0 && (
								<rect
									className="chart-series-1"
									x={x}
									y={simulatedTop}
									width={barWidth}
									height={Math.max(1, baseline - simulatedTop)}
									rx={2}
								/>
							)}
							{day.playground > 0 && (
								<rect
									className="chart-series-2"
									x={x}
									y={playgroundTop}
									width={barWidth}
									height={Math.max(1, simulatedTop - playgroundTop - (day.simulated > 0 ? GAP : 0))}
									rx={2}
								/>
							)}
							{(index % 2 === 0 || days.length <= 7) && (
								<text className="chart-axis-label" x={x + barWidth / 2} y={HEIGHT - 8} textAnchor="middle">
									{shortDay(day.date)}
								</text>
							)}
						</g>
					);
				})}
			</svg>
			<div className="chart-tooltip" role="status" aria-live="polite">
				{active ? (
					<>
						<strong>
							{weekday(active.date)} {shortDay(active.date)}
						</strong>
						<span>
							<i className="chart-swatch chart-series-1" /> Simulated {active.simulated}
						</span>
						<span>
							<i className="chart-swatch chart-series-2" /> Playground {active.playground}
						</span>
					</>
				) : (
					<span className="muted">Hover or focus a day for its counts.</span>
				)}
			</div>
			<details className="chart-table">
				<summary>Show as a table</summary>
				<table className="data-table compact">
					<thead>
						<tr>
							<th scope="col">Day</th>
							<th scope="col">Simulated</th>
							<th scope="col">Playground</th>
						</tr>
					</thead>
					<tbody>
						{days.map((day) => (
							<tr key={day.date}>
								<td>{shortDay(day.date)}</td>
								<td>{day.simulated}</td>
								<td>{day.playground}</td>
							</tr>
						))}
					</tbody>
				</table>
			</details>
		</figure>
	);
}
