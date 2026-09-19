import { useEffect, useId, useState } from "react";
import { ConfirmationDialog } from "../../shared/components/ConfirmationDialog.jsx";
import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { SelectMenu } from "../../shared/components/SelectMenu.jsx";
import { useToast } from "../../shared/components/Toast.jsx";
import { useProject } from "../../shared/context/ProjectContext.jsx";
import { isSameConfig, newRule, normalizeConfig, toPayload, validateDraft } from "./config-draft.js";
import { flagApi } from "./flag.api.js";
import { ImpactPreview } from "./ImpactPreview.jsx";
import { RolloutActiveDialog } from "./RolloutActiveDialog.jsx";
import { RuleEditor } from "./RuleEditor.jsx";
import { ServeEditor } from "./ServeEditor.jsx";

// `mode` is "direct" (save writes a version) or "propose" (the primary action hands the payload to `onPropose`).
// `initialDraft` seeds the editor with a proposal's configuration instead of the live one. `canEdit` false renders read-only.
export function TargetingEditor({ canEdit, config, environment, flag, initialDraft = null, mode = "direct", notice = "", onPropose, onSaved, proposeLabel = "Propose change", segments }) {
	const { project } = useProject();
	const { notify } = useToast();
	const reasonId = `reason-${useId().replace(/:/g, "")}`;
	const [draft, setDraft] = useState(() => normalizeConfig(initialDraft || config));
	const [baseVersion, setBaseVersion] = useState(config.version);
	const [reason, setReason] = useState("");
	const [issues, setIssues] = useState([]);
	const [saving, setSaving] = useState(false);
	const [conflict, setConflict] = useState(false);
	const [rolloutError, setRolloutError] = useState(null);
	const [discarding, setDiscarding] = useState(false);
	const [impact, setImpact] = useState(null);

	// A new server version (after save, reload, or switching environments) resets the draft.
	useEffect(() => {
		setDraft(normalizeConfig(initialDraft || config));
		setBaseVersion(config.version);
		setIssues([]);
		setConflict(false);
		setReason("");
	}, [config, initialDraft]);

	const dirty = !isSameConfig(draft, config);
	const readOnly = !canEdit || saving;
	const variationOptions = flag.variations.map((variation) => ({ value: variation.id, label: variation.name }));
	const segmentKeys = new Set(segments.map((segment) => segment.key));

	const updateRule = (index, rule) => setDraft({ ...draft, rules: draft.rules.map((entry, at) => (at === index ? rule : entry)) });
	const moveRule = (from, to) => {
		const rules = [...draft.rules];
		const [moved] = rules.splice(from, 1);
		rules.splice(to, 0, moved);
		setDraft({ ...draft, rules });
	};

	const validate = () => {
		const found = validateDraft(draft, flag.variations, segmentKeys);
		setIssues(found);
		return found.length === 0;
	};

	const save = async (acknowledgeActiveRollout = false) => {
		if (!validate()) return;
		if (mode === "propose") {
			onPropose?.(toPayload(draft));
			return;
		}
		setSaving(true);
		try {
			const result = await flagApi.updateEnvironment(project.key, flag.key, environment.key, {
				config: toPayload(draft),
				expectedVersion: baseVersion,
				reason: reason.trim(),
				...(acknowledgeActiveRollout ? { acknowledgeActiveRollout: true } : {}),
			});
			setRolloutError(null);
			notify({ kind: "success", message: `${environment.name} saved as v${result.version.version}.` });
			onSaved(result);
		} catch (error) {
			if (error.code === "VERSION_CONFLICT") setConflict(true);
			else if (error.code === "ROLLOUT_ACTIVE") setRolloutError(error);
			else if (error.code === "INVALID_CONFIG" || error.code === "VALIDATION_ERROR") {
				const list = error.details?.issues || [
					...(error.details?.formErrors || []),
					...Object.values(error.details?.fieldErrors || {}).flat(),
				];
				setIssues(list.length ? list : [error.message]);
			} else notify({ kind: "error", message: error.message });
		} finally {
			setSaving(false);
		}
	};

	const previewImpact = async () => {
		if (!validate()) return;
		setImpact({ loading: true, result: null, error: null });
		try {
			const result = await flagApi.impact(project.key, flag.key, environment.key, toPayload(draft));
			setImpact({ loading: false, result, error: null });
		} catch (error) {
			setImpact({ loading: false, result: null, error });
		}
	};

	return (
		<div className="targeting-editor">
			{notice && (
				<div className="banner banner-info" role="status">
					<MaterialIcon size={20}>lock</MaterialIcon>
					<div className="banner-body">
						<span>{notice}</span>
					</div>
				</div>
			)}
			{conflict && (
				<div className="banner banner-warning" role="alert">
					<MaterialIcon size={20}>sync</MaterialIcon>
					<div className="banner-body">
						<span>
							This environment changed since you opened it. Reload to see the latest version; your unsaved edits will be
							discarded.
						</span>
					</div>
					<button className="text-button" type="button" onClick={() => onSaved(null)}>
						Reload
					</button>
				</div>
			)}
			{issues.length > 0 && (
				<div className="banner banner-danger" role="alert">
					<MaterialIcon size={20}>error_outline</MaterialIcon>
					<div className="banner-body">
						{issues.map((issue) => (
							<span key={issue}>{issue}</span>
						))}
					</div>
				</div>
			)}

			<section className="editor-section">
				<div className="editor-toggle">
					<label className="switch">
						<input
							checked={draft.enabled}
							disabled={readOnly}
							role="switch"
							type="checkbox"
							onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
						/>
						<span className="switch-track" aria-hidden="true" />
						<span className="switch-label">
							Targeting is <strong>{draft.enabled ? "on" : "off"}</strong> in {environment.name}
						</span>
					</label>
				</div>
				<div className="editor-off">
					<span className="rule-label">When off, serve</span>
					<SelectMenu
						ariaLabel="Off variation"
						disabled={readOnly}
						onChange={(offVariationId) => setDraft({ ...draft, offVariationId })}
						options={variationOptions}
						value={draft.offVariationId}
					/>
				</div>
			</section>

			<section className="editor-section" aria-labelledby="rules-heading">
				<div className="editor-section-header">
					<h3 id="rules-heading">Rules</h3>
					<span className="muted">Evaluated top to bottom; the first match wins.</span>
				</div>
				{draft.rules.length === 0 && <p className="muted editor-empty">No rules. Everyone gets the fallthrough below.</p>}
				{draft.rules.map((rule, index) => (
					<RuleEditor
						disabled={readOnly}
						index={index}
						key={rule.id}
						onChange={(next) => updateRule(index, next)}
						onMove={moveRule}
						onRemove={() => setDraft({ ...draft, rules: draft.rules.filter((_, at) => at !== index) })}
						rule={rule}
						segments={segments}
						total={draft.rules.length}
						variations={flag.variations}
					/>
				))}
				{!readOnly && draft.rules.length < 25 && (
					<button
						className="text-button"
						type="button"
						onClick={() => setDraft({ ...draft, rules: [...draft.rules, newRule(flag.variations[0].id)] })}
					>
						<MaterialIcon size={18}>add</MaterialIcon> Add rule
					</button>
				)}
			</section>

			<section className="editor-section" aria-labelledby="fallthrough-heading">
				<div className="editor-section-header">
					<h3 id="fallthrough-heading">Fallthrough</h3>
					<span className="muted">Served when targeting is on and no rule matches.</span>
				</div>
				<ServeEditor
					disabled={readOnly}
					label="Fallthrough"
					onChange={(fallthrough) => setDraft({ ...draft, fallthrough })}
					serve={draft.fallthrough}
					variations={flag.variations}
				/>
			</section>

			<footer className="editor-footer">
				{mode === "propose" ? (
					<span className="editor-reason muted">The proposal's title and description are collected on the next step.</span>
				) : (
					<label className="editor-reason" htmlFor={reasonId}>
						<span>Reason</span>
						<input
							disabled={readOnly}
							id={reasonId}
							maxLength={200}
							placeholder="Why this change? (optional, kept in history)"
							type="text"
							value={reason}
							onChange={(event) => setReason(event.target.value)}
						/>
					</label>
				)}
				<div className="editor-actions">
					<button className="text-button" disabled={!dirty || readOnly} type="button" onClick={() => setDiscarding(true)}>
						Discard
					</button>
					<button className="tonal-button" disabled={saving} type="button" onClick={previewImpact}>
						<MaterialIcon size={18}>insights</MaterialIcon> Preview impact
					</button>
					<button
						className="primary-button"
						disabled={!dirty || readOnly || conflict}
						title={!canEdit ? notice : undefined}
						type="button"
						onClick={() => save(false)}
					>
						{saving ? "Saving…" : mode === "propose" ? proposeLabel : "Save"}
					</button>
				</div>
			</footer>

			{discarding && (
				<ConfirmationDialog
					confirmLabel="Discard"
					message="Your unsaved targeting changes will be lost."
					onCancel={() => setDiscarding(false)}
					onConfirm={() => {
						setDraft(normalizeConfig(config));
						setIssues([]);
						setDiscarding(false);
					}}
					title="Discard changes?"
				/>
			)}
			{rolloutError && (
				<RolloutActiveDialog
					busy={saving}
					environmentName={environment.name}
					error={rolloutError}
					onCancel={() => setRolloutError(null)}
					onConfirm={() => save(true)}
				/>
			)}
			{impact && (
				<ImpactPreview
					error={impact.error}
					loading={impact.loading}
					onClose={() => setImpact(null)}
					proposedRules={draft.rules}
					result={impact.result}
					variations={flag.variations}
				/>
			)}
		</div>
	);
}
