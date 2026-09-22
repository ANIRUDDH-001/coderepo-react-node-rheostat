// Pure helpers behind the dashboard payload (spec §7.4).
const DAY_MS = 24 * 60 * 60 * 1000;
const SOURCES = ["playground", "simulated"];

const dateKey = (date) => date.toISOString().slice(0, 10);

// Rows `{ day: "YYYY-MM-DD", source, count }` → one entry per UTC day in [from, to) with zeros where nothing was logged.
export function dailySeries(rows, from, to) {
	const byDay = new Map();
	for (const row of rows) {
		if (!SOURCES.includes(row.source)) continue;
		const entry = byDay.get(row.day) || { playground: 0, simulated: 0 };
		entry[row.source] += row.count;
		byDay.set(row.day, entry);
	}
	const series = [];
	for (let cursor = from.getTime(); cursor < to.getTime(); cursor += DAY_MS) {
		const date = dateKey(new Date(cursor));
		const entry = byDay.get(date) || { playground: 0, simulated: 0 };
		series.push({ date, playground: entry.playground, simulated: entry.simulated });
	}
	return series;
}

// Rows `{ flagKey, variationId, count }` (any environment) → the busiest flags with named variation counts.
export function topFlagDistributions(rows, flags, limit = 8) {
	const byKey = new Map(flags.map((flag) => [flag.key, flag]));
	const totals = new Map();
	for (const row of rows) {
		const flag = byKey.get(row.flagKey);
		if (!flag) continue;
		const entry = totals.get(row.flagKey) || { flagKey: row.flagKey, total: 0, counts: new Map() };
		entry.total += row.count;
		entry.counts.set(row.variationId, (entry.counts.get(row.variationId) || 0) + row.count);
		totals.set(row.flagKey, entry);
	}
	return [...totals.values()]
		.sort((left, right) => right.total - left.total || left.flagKey.localeCompare(right.flagKey))
		.slice(0, limit)
		.map((entry) => {
			const flag = byKey.get(entry.flagKey);
			const nameOf = (id) => flag.variations.find((variation) => variation.id === id)?.name || id || "None";
			return {
				flagKey: entry.flagKey,
				total: entry.total,
				variations: [...entry.counts.entries()]
					.sort((left, right) => right[1] - left[1])
					.map(([variationId, count]) => ({ variationId, name: nameOf(variationId), count })),
			};
		});
}
