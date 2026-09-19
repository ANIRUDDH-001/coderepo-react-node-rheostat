import { useState } from "react";
import { MaterialIcon } from "./MaterialIcon.jsx";

// Free-text chips: Enter or comma adds, Backspace on an empty input removes the last chip.
export function ChipInput({ disabled = false, id, max = 50, normalize = (value) => value.trim(), onChange, placeholder = "Add…", values = [], ...rest }) {
	const [draft, setDraft] = useState("");
	const add = (raw) => {
		const value = normalize(raw);
		if (!value || values.includes(value) || values.length >= max) return;
		onChange([...values, value]);
	};
	const commit = () => {
		if (draft.trim()) add(draft);
		setDraft("");
	};
	return (
		<div className={`chip-input ${disabled ? "chip-input-disabled" : ""}`}>
			{values.map((value) => (
				<span className="chip" key={value}>
					{value}
					{!disabled && (
						<button aria-label={`Remove ${value}`} type="button" onClick={() => onChange(values.filter((item) => item !== value))}>
							<MaterialIcon size={14}>close</MaterialIcon>
						</button>
					)}
				</span>
			))}
			<input
				{...rest}
				disabled={disabled}
				id={id}
				placeholder={values.length ? "" : placeholder}
				type="text"
				value={draft}
				onBlur={commit}
				onChange={(event) => {
					const text = event.target.value;
					if (text.includes(",")) {
						text.split(",").forEach((part) => add(part));
						setDraft("");
					} else setDraft(text);
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						commit();
					} else if (event.key === "Backspace" && !draft && values.length) onChange(values.slice(0, -1));
				}}
			/>
		</div>
	);
}
