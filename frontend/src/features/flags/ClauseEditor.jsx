import { ChipInput } from "../../shared/components/ChipInput.jsx";
import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { SelectMenu } from "../../shared/components/SelectMenu.jsx";
import { KNOWN_ATTRIBUTES, OPERATORS } from "./config-draft.js";

const DATE_OPERATORS = new Set(["before", "after"]);
const NUMBER_OPERATORS = new Set(["greaterThan", "lessThan"]);

function ValuesInput({ clause, disabled, onChange, segments }) {
	if (clause.operator === "segmentMatch") {
		const known = segments.filter((segment) => clause.values.includes(segment.key));
		const options = segments.filter((segment) => !clause.values.includes(segment.key));
		return (
			<div className="segment-values">
				{clause.values.map((key) => (
					<span className="chip" key={key}>
						{known.find((segment) => segment.key === key)?.name || key}
						{!disabled && (
							<button
								aria-label={`Remove ${key}`}
								type="button"
								onClick={() => onChange(clause.values.filter((value) => value !== key))}
							>
								<MaterialIcon size={14}>close</MaterialIcon>
							</button>
						)}
					</span>
				))}
				{!disabled && options.length > 0 && (
					<SelectMenu
						ariaLabel="Add segment"
						onChange={(key) => key && onChange([...clause.values, key])}
						options={[
							{ value: "", label: "Add segment…" },
							...options.map((segment) => ({ value: segment.key, label: segment.name })),
						]}
						value=""
					/>
				)}
				{!segments.length && <span className="form-hint">No segments in this project yet.</span>}
			</div>
		);
	}
	if (DATE_OPERATORS.has(clause.operator)) {
		return (
			<input
				aria-label="Date"
				disabled={disabled}
				type="date"
				value={clause.values[0] || ""}
				onChange={(event) => onChange(event.target.value ? [event.target.value] : [])}
			/>
		);
	}
	if (NUMBER_OPERATORS.has(clause.operator)) {
		return (
			<input
				aria-label="Number"
				disabled={disabled}
				inputMode="decimal"
				step="any"
				type="number"
				value={clause.values[0] ?? ""}
				onChange={(event) => onChange(event.target.value === "" ? [] : [event.target.value])}
			/>
		);
	}
	return (
		<ChipInput
			aria-label="Values"
			disabled={disabled}
			max={50}
			placeholder={clause.operator === "in" ? "value, value…" : "text"}
			values={clause.values}
			onChange={onChange}
		/>
	);
}

export function ClauseEditor({ clause, disabled = false, hideSegments = false, listId, onChange, onRemove, segments = [] }) {
	const operators = hideSegments ? OPERATORS.filter((operator) => operator.value !== "segmentMatch") : OPERATORS;
	const isSegment = clause.operator === "segmentMatch";
	return (
		<div className="clause-row">
			<label className="clause-negate">
				<input
					checked={clause.negate}
					disabled={disabled}
					type="checkbox"
					onChange={(event) => onChange({ ...clause, negate: event.target.checked })}
				/>
				<span>NOT</span>
			</label>
			<input
				aria-label="Attribute"
				className="clause-attribute"
				disabled={disabled || isSegment}
				list={listId}
				maxLength={60}
				placeholder="attribute"
				type="text"
				value={isSegment ? "key" : clause.attribute}
				onChange={(event) => onChange({ ...clause, attribute: event.target.value })}
			/>
			<SelectMenu
				ariaLabel="Operator"
				disabled={disabled}
				onChange={(operator) =>
					onChange({ ...clause, operator, attribute: operator === "segmentMatch" ? "key" : clause.attribute, values: [] })
				}
				options={operators}
				value={clause.operator}
			/>
			<div className="clause-values">
				<ValuesInput
					clause={clause}
					disabled={disabled}
					onChange={(values) => onChange({ ...clause, values })}
					segments={segments}
				/>
			</div>
			{!disabled && (
				<button aria-label="Remove condition" className="icon-button" type="button" onClick={onRemove}>
					<MaterialIcon>close</MaterialIcon>
				</button>
			)}
			<datalist id={listId}>
				{KNOWN_ATTRIBUTES.map((attribute) => (
					<option key={attribute} value={attribute} />
				))}
			</datalist>
		</div>
	);
}
