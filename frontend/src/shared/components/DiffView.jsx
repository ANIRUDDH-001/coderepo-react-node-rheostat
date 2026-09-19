const SECTION_LABELS = { enabled: "Targeting", offVariationId: "Off variation", rules: "Rules", fallthrough: "Fallthrough" };

const sectionOf = (path) => SECTION_LABELS[path.split(".")[0]] || path;

const describeValue = (value, variationName) => {
	if (value === null || value === undefined) return "—";
	if (typeof value === "boolean") return value ? "On" : "Off";
	if (typeof value === "string") return variationName(value);
	if (Array.isArray(value)) return value.map((entry) => describeValue(entry, variationName)).join(", ");
	if (value.rollout) {
		return value.rollout.weights
			.map((entry) => `${variationName(entry.variationId)} ${(entry.weight / 1000).toFixed(entry.weight % 1000 ? 1 : 0)}%`)
			.join(" · ");
	}
	if (value.variationId !== undefined) return `Serve ${variationName(value.variationId)}`;
	if (value.clauses) {
		return `${value.description ? `${value.description}: ` : ""}${value.clauses.map((clause) => describeClause(clause)).join(" AND ")} → ${describeValue(value.serve, variationName)}`;
	}
	if (value.attribute) return describeClause(value);
	return JSON.stringify(value);
};

const describeClause = (clause) =>
	`${clause.negate ? "NOT " : ""}${clause.attribute} ${clause.operator} [${(clause.values || []).join(", ")}]`;

// Rules are keyed by id in the diff; show the description when either side carries one.
const describePath = (entry) => {
	const parts = entry.path.split(".");
	if (parts[0] === "rules") {
		const description = entry.after?.description || entry.before?.description;
		const label = description ? `Rule "${description}"` : `Rule ${parts[1]}`;
		const rest = parts.slice(2);
		if (rest.length === 0) return label;
		if (rest[0] === "clauses") return `${label} · clause ${Number(rest[1]) + 1}${rest[2] ? ` · ${rest[2]}` : ""}`;
		return `${label} · ${rest.join(" · ")}`;
	}
	return SECTION_LABELS[parts[0]] || entry.path;
};

// Renders spec §5.2 diff entries grouped by section. `variations` maps ids to names when provided.
export function DiffView({ diff = [], variations = [] }) {
	const variationName = (id) => variations.find((variation) => variation.id === id)?.name || id;
	if (!diff.length) return <p className="diff-empty">No configuration changes.</p>;
	const sections = new Map();
	for (const entry of diff) {
		const section = sectionOf(entry.path);
		if (!sections.has(section)) sections.set(section, []);
		sections.get(section).push(entry);
	}
	return (
		<div className="diff-view">
			{[...sections.entries()].map(([section, entries]) => (
				<section key={section}>
					<h4>{section}</h4>
					<ul>
						{entries.map((entry) => (
							<li className={`diff-${entry.kind}`} key={entry.path}>
								<span className="diff-kind">{entry.kind}</span>
								<span className="diff-path">{describePath(entry)}</span>
								<span className="diff-values">
									{entry.kind !== "added" && <del>{describeValue(entry.before, variationName)}</del>}
									{entry.kind !== "removed" && <ins>{describeValue(entry.after, variationName)}</ins>}
								</span>
							</li>
						))}
					</ul>
				</section>
			))}
		</div>
	);
}
