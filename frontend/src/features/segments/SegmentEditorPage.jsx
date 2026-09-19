import { useEffect, useId, useState } from "react";
import { ChipInput } from "../../shared/components/ChipInput.jsx";
import { ConfirmationDialog } from "../../shared/components/ConfirmationDialog.jsx";
import { EmptyState } from "../../shared/components/EmptyState.jsx";
import { ErrorBanner } from "../../shared/components/ErrorBanner.jsx";
import { FormField } from "../../shared/components/FormField.jsx";
import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { Skeleton } from "../../shared/components/Skeleton.jsx";
import { useToast } from "../../shared/components/Toast.jsx";
import { useProject } from "../../shared/context/ProjectContext.jsx";
import { useSession } from "../../shared/context/SessionContext.jsx";
import { useAsync } from "../../shared/hooks/useAsync.js";
import { Link } from "../../shared/router/Link.jsx";
import { buildPath } from "../../shared/router/match.js";
import { navigate } from "../../shared/router/router.js";
import { fieldErrors, slugify } from "../../shared/utils/format.js";
import { ClauseEditor } from "../flags/ClauseEditor.jsx";
import { localId, newClause } from "../flags/config-draft.js";
import { segmentApi } from "./segment.api.js";
import { UsageList } from "./SegmentsPage.jsx";

const emptyDraft = () => ({ key: "", name: "", description: "", rules: [], includedKeys: [], excludedKeys: [] });
const toDraft = (segment) => ({
	key: segment.key,
	name: segment.name,
	description: segment.description || "",
	rules: segment.rules.map((rule) => ({ ...rule, clauses: rule.clauses.map((clause) => ({ ...clause, values: [...clause.values] })) })),
	includedKeys: [...segment.includedKeys],
	excludedKeys: [...segment.excludedKeys],
});

function SegmentRule({ disabled, index, listId, onChange, onRemove, rule }) {
	return (
		<article aria-label={`Rule ${index + 1}`} className="rule-card">
			<header className="rule-header">
				<span className="rule-index">Rule {index + 1}</span>
				<input aria-label={`Rule ${index + 1} description`} disabled={disabled} maxLength={200} placeholder="Describe this rule" type="text" value={rule.description} onChange={(event) => onChange({ ...rule, description: event.target.value })} />
				{!disabled && (
					<button aria-label="Delete rule" className="icon-button" type="button" onClick={onRemove}>
						<MaterialIcon>delete</MaterialIcon>
					</button>
				)}
			</header>
			<div className="rule-clauses">
				<span className="rule-label">Member if</span>
				{rule.clauses.map((clause, position) => (
					<div className="clause-line" key={position}>
						{position > 0 && <span className="clause-and">and</span>}
						<ClauseEditor
							clause={clause}
							disabled={disabled}
							hideSegments
							listId={`${listId}-${index}-${position}`}
							onChange={(next) => onChange({ ...rule, clauses: rule.clauses.map((entry, at) => (at === position ? next : entry)) })}
							onRemove={() => onChange({ ...rule, clauses: rule.clauses.filter((_, at) => at !== position) })}
						/>
					</div>
				))}
				{!disabled && rule.clauses.length < 10 && (
					<button className="text-button" type="button" onClick={() => onChange({ ...rule, clauses: [...rule.clauses, newClause()] })}>
						<MaterialIcon size={18}>add</MaterialIcon> Add condition
					</button>
				)}
			</div>
		</article>
	);
}

export function SegmentEditorPage({ segmentKey }) {
	const { project } = useProject();
	const { can } = useSession();
	const { notify } = useToast();
	const listId = `segment-attributes-${useId().replace(/:/g, "")}`;
	const isNew = segmentKey === null;
	const { data: segment, error, loading, reload } = useAsync(() => (isNew ? Promise.resolve(null) : segmentApi.get(project.key, segmentKey)), [project.key, segmentKey]);
	const [draft, setDraft] = useState(emptyDraft);
	const [keyTouched, setKeyTouched] = useState(false);
	const [errors, setErrors] = useState({ fields: {}, general: [] });
	const [busy, setBusy] = useState(false);
	const [confirmDiscard, setConfirmDiscard] = useState(false);
	const canManage = can("segment:manage");
	const readOnly = !canManage || busy;

	useEffect(() => {
		if (segment) setDraft(toDraft(segment));
	}, [segment]);

	const dirty = isNew ? JSON.stringify(draft) !== JSON.stringify(emptyDraft()) : segment && JSON.stringify(draft) !== JSON.stringify(toDraft(segment));

	const validate = () => {
		const general = [];
		draft.rules.forEach((rule, index) => {
			if (!rule.clauses.length) general.push(`Rule ${index + 1} needs at least one condition.`);
			rule.clauses.forEach((clause, position) => {
				if (!clause.attribute.trim()) general.push(`Rule ${index + 1}, condition ${position + 1}: choose an attribute.`);
				if (!clause.values.length) general.push(`Rule ${index + 1}, condition ${position + 1}: add at least one value.`);
			});
		});
		setErrors({ fields: {}, general });
		return general.length === 0;
	};

	const submit = async (event) => {
		event.preventDefault();
		if (!validate()) return;
		setBusy(true);
		try {
			const payload = {
				name: draft.name.trim(),
				description: draft.description.trim(),
				rules: draft.rules.map((rule) => ({ id: rule.id, description: rule.description, clauses: rule.clauses })),
				includedKeys: draft.includedKeys,
				excludedKeys: draft.excludedKeys,
			};
			if (isNew) {
				const created = await segmentApi.create(project.key, { key: draft.key.trim(), ...payload });
				notify({ kind: "success", message: `Segment ${created.key} created.` });
				navigate(buildPath("segments", { projectKey: project.key }));
			} else {
				await segmentApi.update(project.key, segmentKey, payload);
				notify({ kind: "success", message: `Segment ${segmentKey} saved.` });
				reload();
			}
		} catch (caught) {
			const parsed = fieldErrors(caught);
			if (caught.code === "DUPLICATE_KEY") parsed.fields.key = "A segment with this key already exists in the project.";
			if (!parsed.general.length && !Object.keys(parsed.fields).length) parsed.general = [caught.message];
			setErrors(parsed);
		} finally {
			setBusy(false);
		}
	};

	if (!isNew && loading && !segment) return <Skeleton rows={6} />;
	if (error?.code === "SEGMENT_NOT_FOUND") {
		return <EmptyState action={{ label: "Back to segments", onClick: () => navigate(buildPath("segments", { projectKey: project.key })) }} description={`No segment with key ${segmentKey} exists in ${project.name}.`} icon="group" title="Segment not found" />;
	}
	if (error && !segment) return <ErrorBanner message={error.message} onRetry={reload} />;
	if (isNew && !canManage) return <EmptyState description="Your role can view segments but not create them." icon="lock" title="Segments are read-only for you" />;

	return (
		<section className="page segment-editor" aria-labelledby="segment-title">
			<nav aria-label="Breadcrumb" className="breadcrumb">
				<Link to={buildPath("segments", { projectKey: project.key })}>Segments</Link>
				<MaterialIcon size={16}>chevron_right</MaterialIcon>
				<span aria-current="page">{isNew ? "New segment" : segment.name}</span>
			</nav>
			<header className="page-header">
				<div>
					<h1 id="segment-title">{isNew ? "Create segment" : segment.name}</h1>
					{!isNew && (
						<p className="page-subtitle">
							<code>{segment.key}</code>
						</p>
					)}
				</div>
			</header>
			<form className="segment-form" onSubmit={submit}>
				{errors.general.length > 0 && (
					<div className="banner banner-danger" role="alert">
						<MaterialIcon size={20}>error_outline</MaterialIcon>
						<div className="banner-body">
							{errors.general.map((message) => (
								<span key={message}>{message}</span>
							))}
						</div>
					</div>
				)}
				<div className="form-row">
					<FormField error={errors.fields.name} label="Name" required>
						{(props) => (
							<input
								{...props}
								data-autofocus
								disabled={readOnly}
								maxLength={80}
								required
								type="text"
								value={draft.name}
								onChange={(event) => setDraft({ ...draft, name: event.target.value, key: isNew && !keyTouched ? slugify(event.target.value) : draft.key })}
							/>
						)}
					</FormField>
					<FormField error={errors.fields.key} hint={isNew ? "Cannot be changed later." : "Keys are immutable."} label="Key" required>
						{(props) => (
							<input
								{...props}
								disabled={readOnly || !isNew}
								maxLength={40}
								pattern="[a-z][a-z0-9-]{1,39}"
								required
								spellCheck={false}
								type="text"
								value={draft.key}
								onChange={(event) => {
									setKeyTouched(true);
									setDraft({ ...draft, key: event.target.value });
								}}
							/>
						)}
					</FormField>
				</div>
				<FormField error={errors.fields.description} label="Description">
					{(props) => <textarea {...props} disabled={readOnly} maxLength={500} rows={2} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />}
				</FormField>

				<section className="editor-section" aria-labelledby="segment-rules">
					<div className="editor-section-header">
						<h3 id="segment-rules">Rules</h3>
						<span className="muted">A context is a member when any rule matches (all of its conditions).</span>
					</div>
					{draft.rules.length === 0 && <p className="muted editor-empty">No rules. Membership comes only from the included keys below.</p>}
					{draft.rules.map((rule, index) => (
						<SegmentRule
							disabled={readOnly}
							index={index}
							key={rule.id}
							listId={listId}
							onChange={(next) => setDraft({ ...draft, rules: draft.rules.map((entry, at) => (at === index ? next : entry)) })}
							onRemove={() => setDraft({ ...draft, rules: draft.rules.filter((_, at) => at !== index) })}
							rule={rule}
						/>
					))}
					{!readOnly && draft.rules.length < 25 && (
						<button className="text-button" type="button" onClick={() => setDraft({ ...draft, rules: [...draft.rules, { id: localId("sr"), description: "", clauses: [newClause()] }] })}>
							<MaterialIcon size={18}>add</MaterialIcon> Add rule
						</button>
					)}
				</section>

				<div className="form-row">
					<FormField hint="Always members, regardless of rules." label="Included keys">
						{(props) => <ChipInput {...props} disabled={readOnly} max={200} placeholder="context key" values={draft.includedKeys} onChange={(includedKeys) => setDraft({ ...draft, includedKeys })} />}
					</FormField>
					<FormField hint="Never members, even when a rule matches." label="Excluded keys">
						{(props) => <ChipInput {...props} disabled={readOnly} max={200} placeholder="context key" values={draft.excludedKeys} onChange={(excludedKeys) => setDraft({ ...draft, excludedKeys })} />}
					</FormField>
				</div>

				{!isNew && (
					<section className="editor-section" aria-labelledby="segment-usage">
						<div className="editor-section-header">
							<h3 id="segment-usage">Used by</h3>
						</div>
						<UsageList projectKey={project.key} references={segment.referencedBy} />
					</section>
				)}

				{canManage && (
					<footer className="editor-footer">
						<div className="editor-actions">
							<button className="text-button" disabled={busy} type="button" onClick={() => (dirty ? setConfirmDiscard(true) : navigate(buildPath("segments", { projectKey: project.key })))}>
								{dirty ? "Discard" : "Back"}
							</button>
							<button className="primary-button" disabled={busy || !dirty || !draft.name.trim() || !draft.key.trim()} type="submit">
								{busy ? "Saving…" : isNew ? "Create segment" : "Save"}
							</button>
						</div>
					</footer>
				)}
			</form>
			{confirmDiscard && (
				<ConfirmationDialog
					confirmLabel="Discard"
					message="Your unsaved segment changes will be lost."
					onCancel={() => setConfirmDiscard(false)}
					onConfirm={() => {
						setConfirmDiscard(false);
						if (isNew) navigate(buildPath("segments", { projectKey: project.key }));
						else setDraft(toDraft(segment));
					}}
					title="Discard changes?"
				/>
			)}
		</section>
	);
}
