import { useState } from "react";
import { EmptyState } from "../../shared/components/EmptyState.jsx";
import { ErrorBanner } from "../../shared/components/ErrorBanner.jsx";
import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { SelectMenu } from "../../shared/components/SelectMenu.jsx";
import { Skeleton } from "../../shared/components/Skeleton.jsx";
import { useProject } from "../../shared/context/ProjectContext.jsx";
import { useAsync } from "../../shared/hooks/useAsync.js";
import { useRoute } from "../../shared/router/router.js";
import { formatDateTime } from "../../shared/utils/date.js";
import { flagApi } from "../flags/flag.api.js";
import { AudiencePicker } from "./AudiencePicker.jsx";
import { attributesToRows, ContextEditor, rowsToAttributes } from "./ContextEditor.jsx";
import { evaluationApi } from "./evaluation.api.js";
import { EvaluationResults } from "./EvaluationResults.jsx";

const DEFAULT_ROWS = [
	{ name: "plan", type: "string", value: "pro" },
	{ name: "country", type: "string", value: "US" },
];

export function PlaygroundPage() {
	const { project } = useProject();
	const { query, setQuery } = useRoute();
	const environment = project.environments.find((candidate) => candidate.key === query.env) || project.environments[0];
	const [contextKey, setContextKey] = useState(query.key || "user-42");
	const [rows, setRows] = useState(DEFAULT_ROWS);
	const [flagKey, setFlagKey] = useState(query.flag || "");
	const [state, setState] = useState({ result: null, loading: false, error: null });
	const flagsState = useAsync(() => flagApi.list(project.key, { pageSize: 100, sort: "key" }), [project.key]);
	const flags = flagsState.data?.items || [];
	const rulesByFlag = Object.fromEntries(
		flags.map((flag) => [flag.key, { variations: flag.variations, rules: flag.environments[environment.key]?.rules || [] }]),
	);

	const evaluate = async (event) => {
		event?.preventDefault();
		setState({ result: null, loading: true, error: null });
		try {
			const result = await evaluationApi.evaluate(project.key, {
				environment: environment.key,
				context: { key: contextKey.trim(), attributes: rowsToAttributes(rows) },
				...(flagKey ? { flagKeys: [flagKey] } : {}),
			});
			setState({ result, loading: false, error: null });
		} catch (error) {
			setState({ result: null, loading: false, error });
		}
	};

	return (
		<section className="page playground" aria-labelledby="playground-title">
			<header className="page-header">
				<div>
					<h1 id="playground-title">Playground</h1>
					<p className="page-subtitle">
						Evaluate {project.name} flags for any context exactly as an SDK would, with the reason for each result.
					</p>
				</div>
			</header>
			<form className="playground-form" onSubmit={evaluate}>
				<div className="playground-controls">
					<label className="control-label">
						<span>Environment</span>
						<SelectMenu
							ariaLabel="Environment"
							onChange={(env) => setQuery({ env })}
							options={project.environments.map((candidate) => ({ value: candidate.key, label: candidate.name }))}
							value={environment.key}
						/>
					</label>
					<label className="control-label">
						<span>Flag</span>
						<SelectMenu
							ariaLabel="Flag filter"
							disabled={!flags.length}
							onChange={(next) => {
								setFlagKey(next);
								setQuery({ flag: next });
							}}
							options={[
								{ value: "", label: "All active flags" },
								...flags.map((flag) => ({ value: flag.key, label: flag.name })),
							]}
							value={flagKey}
						/>
					</label>
					<AudiencePicker
						disabled={state.loading}
						onSelect={(member) => {
							setContextKey(member.key);
							setRows(attributesToRows(member.attributes));
						}}
						projectKey={project.key}
					/>
				</div>
				<ContextEditor
					contextKey={contextKey}
					disabled={state.loading}
					onKeyChange={setContextKey}
					onRowsChange={setRows}
					rows={rows}
				/>
				<div className="editor-actions">
					<button className="primary-button" disabled={state.loading || !contextKey.trim()} type="submit">
						<MaterialIcon size={18}>play_arrow</MaterialIcon> {state.loading ? "Evaluating…" : "Evaluate"}
					</button>
				</div>
			</form>
			{flagsState.error && (
				<ErrorBanner
					message={`Flags could not be loaded: ${flagsState.error.message}`}
					onRetry={flagsState.reload}
					tone="warning"
				/>
			)}
			{state.loading && <Skeleton rows={4} />}
			{state.error && <ErrorBanner message={state.error.message} onRetry={evaluate} />}
			{!state.loading && !state.error && !state.result && (
				<EmptyState
					description="Set a context above and press Evaluate to see what every flag would serve."
					icon="science"
					title="No evaluation yet"
				/>
			)}
			{state.result && state.result.results.length === 0 && (
				<EmptyState description="This project has no active flags to evaluate." icon="flag" title="Nothing to evaluate" />
			)}
			{state.result && state.result.results.length > 0 && (
				<>
					<p className="muted results-meta">
						{state.result.results.length} flag{state.result.results.length === 1 ? "" : "s"} evaluated in {environment.name} for{" "}
						<code>{state.result.context.key}</code> at {formatDateTime(state.result.evaluatedAt)}. Each run is logged as a
						playground evaluation.
					</p>
					<EvaluationResults
						environment={environment.key}
						projectKey={project.key}
						results={state.result.results}
						rulesByFlag={rulesByFlag}
					/>
				</>
			)}
		</section>
	);
}
