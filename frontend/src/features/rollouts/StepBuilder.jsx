import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";

export const toLocalInput = (date) => {
	const offset = date.getTimezoneOffset() * 60000;
	return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const schedule = (percents, days) => {
	const now = new Date();
	return percents.map((percent, index) => ({
		percent,
		startAt: toLocalInput(new Date(now.getTime() + index * days * 24 * 60 * 60 * 1000)),
	}));
};

export function StepBuilder({ disabled = false, errors = {}, onChange, steps }) {
	const update = (index, field, value) =>
		onChange(steps.map((step, current) => (current === index ? { ...step, [field]: value } : step)));
	return (
		<div className="rollout-step-builder">
			<div className="rollout-presets" aria-label="Schedule presets">
				<button disabled={disabled} type="button" onClick={() => onChange(schedule([5, 25, 50, 100], 1))}>
					5 / 25 / 50 / 100 over 4 days
				</button>
				<button disabled={disabled} type="button" onClick={() => onChange(schedule([10, 50, 100], 1))}>
					10 / 50 / 100 over 3 days
				</button>
			</div>
			<div className="rollout-step-rows">
				{steps.map((step, index) => (
					<div className="rollout-step-row" key={`${index}-${step.startAt}`}>
						<label>
							<span>Audience</span>
							<input
								disabled={disabled}
								min="1"
								max="100"
								type="number"
								value={step.percent}
								onChange={(event) => update(index, "percent", event.target.value)}
							/>
							<span>%</span>
						</label>
						<label>
							<span>Starts</span>
							<input
								disabled={disabled}
								type="datetime-local"
								value={step.startAt}
								onChange={(event) => update(index, "startAt", event.target.value)}
							/>
						</label>
						<button
							aria-label={`Remove step ${index + 1}`}
							className="icon-button"
							disabled={disabled || steps.length === 1}
							type="button"
							onClick={() => onChange(steps.filter((_, current) => current !== index))}
						>
							<MaterialIcon size={18}>close</MaterialIcon>
						</button>
						{errors[index] && <span className="form-error rollout-step-error">{errors[index]}</span>}
					</div>
				))}
			</div>
			<button
				className="text-button"
				disabled={disabled || steps.length >= 12}
				type="button"
				onClick={() => onChange([...steps, { percent: "", startAt: toLocalInput(new Date()) }])}
			>
				<MaterialIcon size={18}>add</MaterialIcon> Add step
			</button>
		</div>
	);
}
