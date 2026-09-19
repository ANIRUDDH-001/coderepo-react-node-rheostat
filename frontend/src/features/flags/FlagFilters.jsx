import { useEffect, useState } from "react";
import { ChipInput } from "../../shared/components/ChipInput.jsx";
import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { SelectMenu } from "../../shared/components/SelectMenu.jsx";
import { useDebouncedValue } from "../../shared/hooks/useAsync.js";

const TYPE_OPTIONS = [
	{ value: "", label: "Any type" },
	{ value: "boolean", label: "Boolean" },
	{ value: "string", label: "String" },
	{ value: "number", label: "Number" },
	{ value: "json", label: "JSON" },
];
const STALE_OPTIONS = [
	{ value: "any", label: "Any lifecycle state" },
	{ value: "readyToRemove", label: "Ready to remove" },
	{ value: "overdue", label: "Overdue" },
];
const STATE_OPTIONS = [
	{ value: "any", label: "Any state" },
	{ value: "on", label: "On" },
	{ value: "off", label: "Off" },
];
const SORT_OPTIONS = [
	{ value: "updated", label: "Recently updated" },
	{ value: "name", label: "Name" },
	{ value: "key", label: "Key" },
	{ value: "stale", label: "Stale first" },
];
const ARCHIVED_OPTIONS = [
	{ value: "false", label: "Active flags" },
	{ value: "true", label: "Archived flags" },
];

export const DEFAULT_FILTERS = {
	query: "",
	type: "",
	stale: "any",
	state: "any",
	environment: "",
	sort: "updated",
	archived: "false",
	tags: "",
};

export function FlagFilters({ environments, filters, onChange }) {
	const [query, setQuery] = useState(filters.query || "");
	const debounced = useDebouncedValue(query, 300);
	useEffect(() => {
		if (debounced !== (filters.query || "")) onChange({ query: debounced, page: "" });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [debounced]);
	useEffect(() => {
		setQuery(filters.query || "");
	}, [filters.query]);
	const environmentOptions = [
		{ value: "", label: "Any environment" },
		...environments.map((env) => ({ value: env.key, label: env.name })),
	];
	const active = Object.entries(filters).some(
		([key, value]) => key !== "page" && key !== "pageSize" && value && value !== DEFAULT_FILTERS[key],
	);
	return (
		<div className="filter-bar" role="group" aria-label="Flag filters">
			<label className="filter-search">
				<MaterialIcon size={20}>search</MaterialIcon>
				<input
					aria-label="Search flags by name, key, or description"
					placeholder="Search flags"
					type="search"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
				/>
			</label>
			<SelectMenu
				ariaLabel="Type"
				onChange={(type) => onChange({ type, page: "" })}
				options={TYPE_OPTIONS}
				value={filters.type || ""}
			/>
			<SelectMenu
				ariaLabel="Lifecycle"
				onChange={(stale) => onChange({ stale, page: "" })}
				options={STALE_OPTIONS}
				value={filters.stale || "any"}
			/>
			<SelectMenu
				ariaLabel="Environment"
				onChange={(environment) => onChange({ environment, page: "" })}
				options={environmentOptions}
				value={filters.environment || ""}
			/>
			<SelectMenu
				ariaLabel="State"
				disabled={!filters.environment}
				onChange={(state) => onChange({ state, page: "" })}
				options={STATE_OPTIONS}
				value={filters.environment ? filters.state || "any" : "any"}
			/>
			<SelectMenu
				ariaLabel="Sort"
				onChange={(sort) => onChange({ sort, page: "" })}
				options={SORT_OPTIONS}
				value={filters.sort || "updated"}
			/>
			<SelectMenu
				ariaLabel="Archived"
				onChange={(archived) => onChange({ archived, page: "" })}
				options={ARCHIVED_OPTIONS}
				value={filters.archived || "false"}
			/>
			<div className="filter-tags">
				<ChipInput
					aria-label="Filter by tags"
					max={10}
					normalize={(value) => value.trim().toLowerCase()}
					placeholder="Tags"
					values={filters.tags ? filters.tags.split(",") : []}
					onChange={(tags) => onChange({ tags: tags.join(","), page: "" })}
				/>
			</div>
			{active && (
				<button className="text-button" type="button" onClick={() => onChange({ ...DEFAULT_FILTERS, page: "", pageSize: "" })}>
					Clear filters
				</button>
			)}
		</div>
	);
}
