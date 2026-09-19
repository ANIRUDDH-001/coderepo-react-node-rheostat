import { SelectMenu } from "../../shared/components/SelectMenu.jsx";
import { evenWeights } from "./config-draft.js";
import { WeightSliders } from "./WeightSliders.jsx";

// A "serve" is either one fixed variation or a percentage rollout across variations.
export function ServeEditor({ disabled = false, label, onChange, serve, variations }) {
	const mode = serve.rollout ? "rollout" : "fixed";
	const options = variations.map((variation) => ({ value: variation.id, label: variation.name }));
	return (
		<div className="serve-editor">
			<div className="serve-mode" role="radiogroup" aria-label={`${label} mode`}>
				<label>
					<input
						checked={mode === "fixed"}
						disabled={disabled}
						name={`${label}-mode`}
						type="radio"
						onChange={() => onChange({ variationId: serve.rollout?.weights?.[0]?.variationId || variations[0].id })}
					/>
					Serve one variation
				</label>
				<label>
					<input
						checked={mode === "rollout"}
						disabled={disabled}
						name={`${label}-mode`}
						type="radio"
						onChange={() => onChange({ rollout: { bucketBy: "key", weights: evenWeights(variations) } })}
					/>
					Percentage rollout
				</label>
			</div>
			{mode === "fixed" ? (
				<SelectMenu
					ariaLabel={`${label} variation`}
					disabled={disabled}
					onChange={(variationId) => onChange({ variationId })}
					options={options}
					value={serve.variationId || variations[0].id}
				/>
			) : (
				<>
					<WeightSliders
						disabled={disabled}
						onChange={(weights) => onChange({ rollout: { ...serve.rollout, weights } })}
						variations={variations}
						weights={serve.rollout.weights}
					/>
					<label className="bucket-by">
						<span>Bucket by attribute</span>
						<input
							aria-label="Bucket by attribute"
							disabled={disabled}
							maxLength={60}
							placeholder="key"
							type="text"
							value={serve.rollout.bucketBy === "key" ? "" : serve.rollout.bucketBy}
							onChange={(event) => onChange({ rollout: { ...serve.rollout, bucketBy: event.target.value.trim() || "key" } })}
						/>
					</label>
				</>
			)}
		</div>
	);
}
