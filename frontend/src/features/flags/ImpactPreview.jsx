import { useId } from "react";
import { createPortal } from "react-dom";
import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { Modal } from "../../shared/components/Modal.jsx";
import { formatValue } from "../../shared/utils/format.js";

const REASON_TEXT = { KILL_SWITCH: "kill switch", OFF: "off", FALLTHROUGH: "fallthrough", RULE_MATCH: "rule", ERROR: "error" };

function Distribution({ counts, label, total, variations }) {
	const entries = variations.map((variation) => ({ ...variation, count: counts[variation.id] || 0 }));
	return (
		<div className="impact-distribution">
			<h4>{label}</h4>
			<div className="impact-bar" aria-hidden="true">
				{entries.map((entry, index) => (
					<span className={`weight-bar-segment weight-tone-${index % 6}`} key={entry.id} style={{ width: `${total ? (entry.count / total) * 100 : 0}%` }} />
				))}
			</div>
			<ul>
				{entries.map((entry, index) => (
					<li key={entry.id}>
						<span className={`impact-swatch weight-tone-${index % 6}`} aria-hidden="true" />
						<span>{entry.name}</span>
						<strong>{entry.count}</strong>
						<span className="muted">{total ? `${((entry.count / total) * 100).toFixed(1)}%` : "0%"}</span>
					</li>
				))}
			</ul>
		</div>
	);
}

const ruleLabel = (reason, rules) => {
	if (reason.kind !== "RULE_MATCH") return REASON_TEXT[reason.kind] || reason.kind;
	const index = rules.findIndex((rule) => rule.id === reason.ruleId);
	return index >= 0 ? `rule ${index + 1}` : "rule";
};

// Before/after audience distribution for a proposed configuration. Rendered as a dialog from the editor.
export function ImpactPreview({ error = null, loading = false, onClose, proposedRules = [], result, variations }) {
	const titleId = `impact-${useId().replace(/:/g, "")}`;
	const variationName = (id) => variations.find((variation) => variation.id === id)?.name || id;
	return createPortal(
		<Modal className="impact-dialog" labelledBy={titleId} onClose={onClose}>
			<section className="dialog-form">
				<header className="dialog-header">
					<h2 id={titleId}>Impact preview</h2>
					<button aria-label="Close" className="icon-button" data-autofocus type="button" onClick={onClose}>
						<MaterialIcon>close</MaterialIcon>
					</button>
				</header>
				<div className="dialog-body">
					{loading && <p className="muted">Evaluating the synthetic audience…</p>}
					{error && (
						<div className="banner banner-danger" role="alert">
							<MaterialIcon size={20}>error_outline</MaterialIcon>
							<div className="banner-body">
								<span>{error.message}</span>
								{(error.details?.issues || []).map((issue) => (
									<span key={issue}>{issue}</span>
								))}
							</div>
						</div>
					)}
					{result && (
						<>
							<p className="impact-summary">
								<strong>{result.flipped}</strong> of {result.audienceSize} audience members would receive a different variation.
							</p>
							<div className="impact-grid">
								<Distribution counts={result.before} label="Current" total={result.audienceSize} variations={variations} />
								<Distribution counts={result.after} label="Proposed" total={result.audienceSize} variations={variations} />
							</div>
							<h4>Attribution after the change</h4>
							<ul className="impact-attribution">
								{Object.entries(result.attribution.after).map(([key, count]) => (
									<li key={key}>
										<span>{key === "fallthrough" || key === "off" || key === "killSwitch" ? key : `rule ${Math.max(1, proposedRules.findIndex((rule) => rule.id === key) + 1)}`}</span>
										<strong>{count}</strong>
									</li>
								))}
							</ul>
							{result.flippedSample.length > 0 && (
								<>
									<h4>Sample of affected members</h4>
									<div className="table-scroll">
										<table className="data-table compact">
											<thead>
												<tr>
													<th scope="col">Member</th>
													<th scope="col">Attributes</th>
													<th scope="col">Before</th>
													<th scope="col">After</th>
												</tr>
											</thead>
											<tbody>
												{result.flippedSample.map((entry) => (
													<tr key={entry.key}>
														<td>
															<strong>{entry.name}</strong>
															<br />
															<code>{entry.key}</code>
														</td>
														<td className="muted">
															{entry.attributes.plan} · {entry.attributes.country} · {entry.attributes.platform}
														</td>
														<td>
															{variationName(entry.before.variationId)} <span className="muted">({ruleLabel(entry.before.reason, [])})</span>
														</td>
														<td>
															{variationName(entry.after.variationId)} <span className="muted">({ruleLabel(entry.after.reason, proposedRules)})</span>
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								</>
							)}
							{result.flipped === 0 && <p className="muted">Nobody in the audience changes variation. {formatValue("")}</p>}
						</>
					)}
				</div>
				<footer className="dialog-footer">
					<button className="primary-button" type="button" onClick={onClose}>
						Done
					</button>
				</footer>
			</section>
		</Modal>,
		document.body,
	);
}
