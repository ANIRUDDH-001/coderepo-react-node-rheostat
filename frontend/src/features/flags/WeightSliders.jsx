import { BUCKET_SPACE } from "./config-draft.js";

const clamp = (value) => Math.max(0, Math.min(BUCKET_SPACE, Math.round(value)));

// Percentages with one decimal; the last variation absorbs the remainder so the split always totals 100%.
export function WeightSliders({ disabled = false, onChange, variations, weights }) {
	const weightOf = (id) => weights.find((entry) => entry.variationId === id)?.weight ?? 0;
	const setWeight = (id, next) => {
		const others = variations.filter((variation) => variation.id !== id);
		const last = others.at(-1);
		const updated = variations.map((variation) => ({ variationId: variation.id, weight: variation.id === id ? clamp(next) : weightOf(variation.id) }));
		const sumWithoutLast = updated.filter((entry) => entry.variationId !== last.id).reduce((sum, entry) => sum + entry.weight, 0);
		const remainder = BUCKET_SPACE - sumWithoutLast;
		if (remainder < 0) {
			// The moved slider took more than the rest could give: cap it.
			const capped = updated.map((entry) => (entry.variationId === id ? { ...entry, weight: entry.weight + remainder } : entry));
			onChange(capped.map((entry) => (entry.variationId === last.id ? { ...entry, weight: 0 } : entry)));
			return;
		}
		onChange(updated.map((entry) => (entry.variationId === last.id ? { ...entry, weight: remainder } : entry)));
	};
	const total = weights.reduce((sum, entry) => sum + entry.weight, 0);
	return (
		<div className="weight-sliders">
			{variations.map((variation) => {
				const weight = weightOf(variation.id);
				return (
					<div className="weight-row" key={variation.id}>
						<span className="weight-name">{variation.name}</span>
						<input
							aria-label={`${variation.name} percentage`}
							disabled={disabled}
							max={100}
							min={0}
							step={0.1}
							type="range"
							value={weight / 1000}
							onChange={(event) => setWeight(variation.id, Number(event.target.value) * 1000)}
						/>
						<input
							aria-label={`${variation.name} percentage value`}
							className="weight-number"
							disabled={disabled}
							inputMode="decimal"
							max={100}
							min={0}
							step={0.1}
							type="number"
							value={(weight / 1000).toFixed(weight % 1000 ? 1 : 0)}
							onChange={(event) => setWeight(variation.id, Number(event.target.value || 0) * 1000)}
						/>
						<span aria-hidden="true">%</span>
					</div>
				);
			})}
			<div className="weight-bar" aria-hidden="true">
				{variations.map((variation, index) => (
					<span className={`weight-bar-segment weight-tone-${index % 6}`} key={variation.id} style={{ width: `${weightOf(variation.id) / 1000}%` }} />
				))}
			</div>
			{total !== BUCKET_SPACE && (
				<span className="form-error" role="alert">
					Weights add up to {(total / 1000).toFixed(1)}%; they must total 100%.
				</span>
			)}
		</div>
	);
}
