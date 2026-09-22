import { useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ErrorBanner } from "../../shared/components/ErrorBanner.jsx";
import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { Modal } from "../../shared/components/Modal.jsx";
import { StepBuilder, toLocalInput } from "./StepBuilder.jsx";

const initialSteps = () => [{ percent: 5, startAt: toLocalInput(new Date()) }];

function servedVariation(config) {
	if (config?.fallthrough?.variationId) return config.fallthrough.variationId;
	const weights = config?.fallthrough?.rollout?.weights || [];
	return weights.reduce((best, entry) => (entry.weight > (best?.weight || 0) ? entry : best), null)?.variationId || "";
}

function validate({ baselineVariationId, bucketBy, steps, targetVariationId }) {
	const errors = {};
	if (!targetVariationId) errors.target = "Choose the variation to introduce.";
	if (!baselineVariationId) errors.baseline = "This environment is not currently serving a variation.";
	if (targetVariationId && targetVariationId === baselineVariationId) errors.target = "Choose a variation other than the baseline.";
	if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(bucketBy)) errors.bucketBy = "Use an attribute name such as key or user.id.";
	let lastPercent = 0;
	let lastStart = null;
	const stepErrors = {};
	steps.forEach((step, index) => {
		const percent = Number(step.percent);
		const start = new Date(step.startAt);
		if (!Number.isInteger(percent) || percent < 1 || percent > 100) stepErrors[index] = "Use a whole percentage from 1 to 100.";
		else if (percent <= lastPercent) stepErrors[index] = "Each percentage must be higher than the previous step.";
		if (Number.isNaN(start.getTime())) stepErrors[index] = "Choose a valid start time.";
		else if (lastStart && start <= lastStart) stepErrors[index] = "Each start time must be later than the previous step.";
		if (Number.isInteger(percent)) lastPercent = Math.max(lastPercent, percent);
		if (!Number.isNaN(start.getTime())) lastStart = start;
	});
	if (Object.keys(stepErrors).length) errors.steps = stepErrors;
	return errors;
}

export function RolloutPlanner({ config, environment, flag, onClose, onCreate }) {
	const titleId = `rollout-plan-${useId().replace(/:/g, "")}`;
	const baseline = servedVariation(config);
	const [targetVariationId, setTargetVariationId] = useState(flag.variations.find((variation) => variation.id !== baseline)?.id || "");
	const [bucketBy, setBucketBy] = useState("key");
	const [steps, setSteps] = useState(initialSteps);
	const [errors, setErrors] = useState({});
	const [failure, setFailure] = useState("");
	const [busy, setBusy] = useState(false);
	const baselineName = flag.variations.find((variation) => variation.id === baseline)?.name || "No served variation";

	const targetOptions = useMemo(
		() =>
			flag.variations
				.filter((variation) => variation.id !== baseline)
				.map((variation) => ({ value: variation.id, label: variation.name })),
		[baseline, flag.variations],
	);
	const submit = async (event) => {
		event.preventDefault();
		const nextErrors = validate({ baselineVariationId: baseline, bucketBy, steps, targetVariationId });
		setErrors(nextErrors);
		if (Object.keys(nextErrors).length) return;
		setBusy(true);
		setFailure("");
		try {
			await onCreate({
				flagKey: flag.key,
				environment: environment.key,
				targetVariationId,
				baselineVariationId: baseline,
				bucketBy,
				steps: steps.map((step) => ({ percent: Number(step.percent), startAt: new Date(step.startAt).toISOString() })),
			});
		} catch (caught) {
			setFailure(caught.message);
		} finally {
			setBusy(false);
		}
	};

	return createPortal(
		<Modal className="form-dialog" labelledBy={titleId} onClose={() => !busy && onClose()}>
			<form className="dialog-form" onSubmit={submit}>
				<header className="dialog-header">
					<h2 id={titleId}>Plan a rollout in {environment.name}</h2>
					<button aria-label="Close" className="icon-button" disabled={busy} type="button" onClick={onClose}>
						<MaterialIcon>close</MaterialIcon>
					</button>
				</header>
				<div className="dialog-body">
					{failure && <ErrorBanner message={failure} />}
					<p>Rheostat progressively shifts the fallthrough audience from the current variation to the target variation.</p>
					<div className="form-row">
						<label className="form-field">
							<span>Baseline variation</span>
							<input disabled value={baselineName} />
							<span className="form-hint">Locked to the variation currently served in {environment.name}.</span>
							{errors.baseline && <span className="form-error">{errors.baseline}</span>}
						</label>
						<label className="form-field">
							<span>Target variation</span>
							<select
								disabled={busy || !baseline}
								value={targetVariationId}
								onChange={(event) => setTargetVariationId(event.target.value)}
							>
								<option value="">Choose a variation</option>
								{targetOptions.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
							{errors.target && <span className="form-error">{errors.target}</span>}
						</label>
					</div>
					<label className="form-field bucket-by">
						<span>Bucket by</span>
						<input disabled={busy} value={bucketBy} onChange={(event) => setBucketBy(event.target.value)} />
						<span className="form-hint">Use a stable audience attribute. The default key is suitable for most rollouts.</span>
						{errors.bucketBy && <span className="form-error">{errors.bucketBy}</span>}
					</label>
					<section className="editor-section" aria-labelledby="rollout-steps-title">
						<div className="editor-section-header">
							<h3 id="rollout-steps-title">Rollout steps</h3>
							<span className="muted">Set the audience percentage at each point in time.</span>
						</div>
						<StepBuilder disabled={busy} errors={errors.steps} onChange={setSteps} steps={steps} />
					</section>
				</div>
				<footer className="dialog-footer">
					<button className="text-button" disabled={busy} type="button" onClick={onClose}>
						Cancel
					</button>
					<button className="primary-button" disabled={busy || !baseline} type="submit">
						Create rollout
					</button>
				</footer>
			</form>
		</Modal>,
		document.body,
	);
}
