import { useId } from "react";
import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { ClauseEditor } from "./ClauseEditor.jsx";
import { newClause } from "./config-draft.js";
import { ServeEditor } from "./ServeEditor.jsx";

export function RuleEditor({ disabled = false, index, onChange, onMove, onRemove, rule, segments, total, variations }) {
	const listId = `attributes-${useId().replace(/:/g, "")}`;
	const updateClause = (position, clause) => onChange({ ...rule, clauses: rule.clauses.map((entry, at) => (at === position ? clause : entry)) });
	return (
		<article aria-label={`Rule ${index + 1}`} className="rule-card">
			<header className="rule-header">
				<span className="rule-index">Rule {index + 1}</span>
				<input
					aria-label={`Rule ${index + 1} description`}
					disabled={disabled}
					maxLength={200}
					placeholder="Describe who this rule targets"
					type="text"
					value={rule.description}
					onChange={(event) => onChange({ ...rule, description: event.target.value })}
				/>
				{!disabled && (
					<div className="rule-actions">
						<button aria-label="Move rule up" className="icon-button" disabled={index === 0} type="button" onClick={() => onMove(index, index - 1)}>
							<MaterialIcon>expand_less</MaterialIcon>
						</button>
						<button aria-label="Move rule down" className="icon-button" disabled={index === total - 1} type="button" onClick={() => onMove(index, index + 1)}>
							<MaterialIcon>expand_more</MaterialIcon>
						</button>
						<button aria-label="Delete rule" className="icon-button" type="button" onClick={onRemove}>
							<MaterialIcon>delete</MaterialIcon>
						</button>
					</div>
				)}
			</header>
			<div className="rule-clauses">
				<span className="rule-label">If</span>
				{rule.clauses.map((clause, position) => (
					<div className="clause-line" key={position}>
						{position > 0 && <span className="clause-and">and</span>}
						<ClauseEditor
							clause={clause}
							disabled={disabled}
							listId={`${listId}-${position}`}
							onChange={(next) => updateClause(position, next)}
							onRemove={() => onChange({ ...rule, clauses: rule.clauses.filter((_, at) => at !== position) })}
							segments={segments}
						/>
					</div>
				))}
				{!disabled && rule.clauses.length < 10 && (
					<button className="text-button" type="button" onClick={() => onChange({ ...rule, clauses: [...rule.clauses, newClause()] })}>
						<MaterialIcon size={18}>add</MaterialIcon> Add condition
					</button>
				)}
			</div>
			<div className="rule-serve">
				<span className="rule-label">Then</span>
				<ServeEditor disabled={disabled} label={`Rule ${index + 1}`} onChange={(serve) => onChange({ ...rule, serve })} serve={rule.serve} variations={variations} />
			</div>
		</article>
	);
}
