import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { SelectMenu } from "../../shared/components/SelectMenu.jsx";
import { KNOWN_ATTRIBUTES } from "../flags/config-draft.js";

const TYPE_OPTIONS = [
	{ value: "string", label: "Text" },
	{ value: "number", label: "Number" },
	{ value: "boolean", label: "Boolean" },
];

export const rowsToAttributes = (rows) => {
	const attributes = {};
	for (const row of rows) {
		const name = row.name.trim();
		if (!name) continue;
		if (row.type === "number") attributes[name] = row.value === "" ? 0 : Number(row.value);
		else if (row.type === "boolean") attributes[name] = row.value === true || row.value === "true";
		else attributes[name] = String(row.value ?? "");
	}
	return attributes;
};

export const attributesToRows = (attributes) =>
	Object.entries(attributes).map(([name, value]) => ({
		name,
		type: typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string",
		value,
	}));

// Context key plus typed attribute rows. Values are typed so number/boolean comparisons behave like production.
export function ContextEditor({ contextKey, disabled, onKeyChange, onRowsChange, rows }) {
	const update = (index, patch) => onRowsChange(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));
	return (
		<div className="context-editor">
			<label className="context-key">
				<span>Context key</span>
				<input
					disabled={disabled}
					maxLength={120}
					placeholder="user-123"
					type="text"
					value={contextKey}
					onChange={(event) => onKeyChange(event.target.value)}
				/>
			</label>
			<div className="attribute-rows">
				{rows.map((row, index) => (
					<div className="attribute-row" key={index}>
						<input
							aria-label={`Attribute ${index + 1} name`}
							disabled={disabled}
							list="context-attribute-names"
							maxLength={60}
							placeholder="attribute"
							type="text"
							value={row.name}
							onChange={(event) => update(index, { name: event.target.value })}
						/>
						<SelectMenu
							ariaLabel={`Attribute ${index + 1} type`}
							disabled={disabled}
							onChange={(type) => update(index, { type, value: type === "boolean" ? true : type === "number" ? 0 : "" })}
							options={TYPE_OPTIONS}
							value={row.type}
						/>
						{row.type === "boolean" ? (
							<SelectMenu
								ariaLabel={`Attribute ${index + 1} value`}
								disabled={disabled}
								onChange={(value) => update(index, { value: value === "true" })}
								options={[
									{ value: "true", label: "true" },
									{ value: "false", label: "false" },
								]}
								value={String(row.value)}
							/>
						) : (
							<input
								aria-label={`Attribute ${index + 1} value`}
								disabled={disabled}
								inputMode={row.type === "number" ? "decimal" : undefined}
								maxLength={200}
								placeholder="value"
								step={row.type === "number" ? "any" : undefined}
								type={row.type === "number" ? "number" : "text"}
								value={row.value}
								onChange={(event) => update(index, { value: event.target.value })}
							/>
						)}
						<button
							aria-label={`Remove attribute ${index + 1}`}
							className="icon-button"
							disabled={disabled}
							type="button"
							onClick={() => onRowsChange(rows.filter((_, at) => at !== index))}
						>
							<MaterialIcon>close</MaterialIcon>
						</button>
					</div>
				))}
				{rows.length < 30 && (
					<button
						className="text-button"
						disabled={disabled}
						type="button"
						onClick={() => onRowsChange([...rows, { name: "", type: "string", value: "" }])}
					>
						<MaterialIcon size={18}>add</MaterialIcon> Add attribute
					</button>
				)}
			</div>
			<datalist id="context-attribute-names">
				{KNOWN_ATTRIBUTES.filter((attribute) => attribute !== "key").map((attribute) => (
					<option key={attribute} value={attribute} />
				))}
			</datalist>
		</div>
	);
}
