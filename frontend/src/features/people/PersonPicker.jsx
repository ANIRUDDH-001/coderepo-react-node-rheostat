import { SelectMenu } from "../../shared/components/SelectMenu.jsx";
import { useAsync } from "../../shared/hooks/useAsync.js";
import { peopleApi } from "./people.api.js";

// Owner / reviewer picker over the workspace people list. `value` is a person id or "" (unassigned).
export function PersonPicker({ allowNone = true, ariaLabel = "Person", disabled = false, noneLabel = "Unassigned", onChange, value }) {
	const { data: people, error } = useAsync(() => peopleApi.search(""), []);
	const options = [
		...(allowNone ? [{ value: "", label: noneLabel }] : []),
		...(people || []).map((person) => ({ value: person._id, label: person.name })),
	];
	if (error) options.push({ value: value || "", label: "People unavailable" });
	return <SelectMenu ariaLabel={ariaLabel} disabled={disabled || !people} onChange={onChange} options={options} value={value || ""} />;
}
