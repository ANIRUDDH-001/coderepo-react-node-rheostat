import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";

// Typed value input per flag type. Existing variations keep their value (immutable); new ones are editable.
export function VariationValueInput({ disabled, id, onChange, type, value }) {
	if (type === "boolean") return <input disabled id={id} readOnly type="text" value={String(value)} />;
	if (type === "number") {
		return (
			<input
				disabled={disabled}
				id={id}
				inputMode="decimal"
				step="any"
				type="number"
				value={value ?? ""}
				onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))}
			/>
		);
	}
	if (type === "json") {
		return (
			<textarea
				disabled={disabled}
				id={id}
				rows={2}
				spellCheck={false}
				value={typeof value === "string" ? value : JSON.stringify(value ?? {})}
				onChange={(event) => onChange(event.target.value)}
			/>
		);
	}
	return (
		<input
			disabled={disabled}
			id={id}
			maxLength={500}
			type="text"
			value={value ?? ""}
			onChange={(event) => onChange(event.target.value)}
		/>
	);
}

export const MAX_VARIATIONS = 8;

// `rows` = [{ id?, name, value, existing }] — existing rows can only be renamed; boolean flags are fixed.
export function VariationsEditor({ errors = {}, onChange, rows, type }) {
	const canAppend = type !== "boolean" && rows.length < MAX_VARIATIONS;
	const update = (index, patch) => onChange(rows.map((row, position) => (position === index ? { ...row, ...patch } : row)));
	return (
		<div className="variations-editor">
			<div className="variations-header" aria-hidden="true">
				<span>Name</span>
				<span>Value</span>
				<span />
			</div>
			{rows.map((row, index) => (
				<div className="variation-row" key={row.id || `new-${index}`}>
					<input
						aria-label={`Variation ${index + 1} name`}
						disabled={type === "boolean"}
						maxLength={60}
						type="text"
						value={row.name}
						onChange={(event) => update(index, { name: event.target.value })}
					/>
					<div>
						<VariationValueInput
							disabled={Boolean(row.existing) || type === "boolean"}
							onChange={(value) => update(index, { value })}
							type={type}
							value={row.value}
						/>
						{errors[index] && (
							<span className="form-error" role="alert">
								{errors[index]}
							</span>
						)}
					</div>
					{!row.existing && type !== "boolean" && rows.length > 2 ? (
						<button
							aria-label={`Remove variation ${index + 1}`}
							className="icon-button"
							type="button"
							onClick={() => onChange(rows.filter((_, position) => position !== index))}
						>
							<MaterialIcon>delete</MaterialIcon>
						</button>
					) : (
						<span className="variation-lock" title={row.existing ? "Existing variations keep their value" : ""}>
							{row.existing && <MaterialIcon size={16}>lock</MaterialIcon>}
						</span>
					)}
				</div>
			))}
			{canAppend && (
				<button
					className="text-button"
					type="button"
					onClick={() =>
						onChange([...rows, { name: "", value: type === "json" ? "{}" : type === "number" ? "" : "", existing: false }])
					}
				>
					<MaterialIcon size={18}>add</MaterialIcon> Add variation
				</button>
			)}
			{type === "boolean" && <p className="form-hint">Boolean flags always serve True or False.</p>}
		</div>
	);
}

// Converts editor rows into API payload values, validating JSON and numbers. Returns { variations, errors }.
export function serializeVariations(rows, type) {
	const errors = {};
	const variations = rows.map((row, index) => {
		let value = row.value;
		if (row.existing) return { id: row.id, name: row.name.trim() };
		if (type === "json") {
			try {
				value = typeof value === "string" ? JSON.parse(value || "{}") : value;
				if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object");
			} catch {
				errors[index] = "Provide a JSON object.";
			}
		} else if (type === "number") {
			if (value === "" || value === null || Number.isNaN(Number(value))) errors[index] = "Provide a number.";
			else value = Number(value);
		} else if (type === "string" && !String(value ?? "").trim()) errors[index] = "Provide a value.";
		if (!row.name.trim()) errors[index] = "Provide a name.";
		return { ...(row.id ? { id: row.id } : {}), name: row.name.trim(), value };
	});
	return { variations, errors };
}
