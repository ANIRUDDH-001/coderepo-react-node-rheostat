import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { DiffView } from "../../shared/components/DiffView.jsx";
import { ErrorBanner } from "../../shared/components/ErrorBanner.jsx";
import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { Modal } from "../../shared/components/Modal.jsx";
import { SelectMenu } from "../../shared/components/SelectMenu.jsx";
import { Skeleton } from "../../shared/components/Skeleton.jsx";
import { useToast } from "../../shared/components/Toast.jsx";
import { useProject } from "../../shared/context/ProjectContext.jsx";
import { useSession } from "../../shared/context/SessionContext.jsx";
import { useAsync } from "../../shared/hooks/useAsync.js";
import { buildPath } from "../../shared/router/match.js";
import { navigate } from "../../shared/router/router.js";
import { flagApi } from "./flag.api.js";
import { RolloutActiveDialog } from "./RolloutActiveDialog.jsx";

// Compare a target environment with a source and promote: directly when unprotected, as a change request otherwise.
export function EnvironmentCompare({ environment, flag, onClose, onPromoted }) {
	const { project } = useProject();
	const { can } = useSession();
	const { notify } = useToast();
	const titleId = `compare-${useId().replace(/:/g, "")}`;
	const others = project.environments.filter((candidate) => candidate.key !== environment.key);
	const [source, setSource] = useState(others[0].key);
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState("");
	const [rolloutError, setRolloutError] = useState(null);
	const { data, error, loading, reload } = useAsync(
		() => flagApi.compare(project.key, flag.key, environment.key, source),
		[project.key, flag.key, environment.key, source],
	);
	const sourceEnvironment = others.find((candidate) => candidate.key === source);
	const viaChangeRequest = environment.protected;
	const allowed = flag.archived ? false : viaChangeRequest ? can("changeRequest:create") : can("flag:editConfig:unprotected");
	const identical = data && data.diff.length === 0;

	const promote = async (acknowledge = false) => {
		setBusy(true);
		setFailure("");
		try {
			const result = await flagApi.promote(project.key, flag.key, environment.key, {
				source,
				...(acknowledge ? { acknowledgeActiveRollout: true } : {}),
			});
			setRolloutError(null);
			if (result.kind === "changeRequest") {
				notify({ kind: "success", message: "Promotion proposed as a change request." });
				navigate(buildPath("changeRequest", { projectKey: project.key, id: result.changeRequest._id }));
			} else {
				notify({ kind: "success", message: `${environment.name} promoted to v${result.version.version}.` });
				onPromoted();
			}
		} catch (caught) {
			if (caught.code === "ROLLOUT_ACTIVE") setRolloutError(caught);
			else setFailure(caught.message);
		} finally {
			setBusy(false);
		}
	};

	return createPortal(
		<Modal className="form-dialog" labelledBy={titleId} onClose={() => !busy && onClose()}>
			<section className="dialog-form">
				<header className="dialog-header">
					<h2 id={titleId}>Compare and promote into {environment.name}</h2>
					<button aria-label="Close" className="icon-button" disabled={busy} type="button" onClick={onClose}>
						<MaterialIcon>close</MaterialIcon>
					</button>
				</header>
				<div className="dialog-body">
					<div className="compare-controls">
						<span className="rule-label">Copy targeting from</span>
						<SelectMenu
							ariaLabel="Source environment"
							disabled={busy}
							onChange={setSource}
							options={others.map((candidate) => ({ value: candidate.key, label: candidate.name }))}
							value={source}
						/>
						<span className="muted">
							{data ? `${sourceEnvironment.name} v${data.source.version} → ${environment.name} v${data.target.version}` : ""}
						</span>
					</div>
					{viaChangeRequest && (
						<div className="banner banner-info" role="status">
							<MaterialIcon size={20}>lock</MaterialIcon>
							<div className="banner-body">
								<span>
									{environment.name} is protected: promoting opens a change request for review instead of applying
									immediately.
								</span>
							</div>
						</div>
					)}
					{failure && <ErrorBanner message={failure} />}
					{loading && !data && <Skeleton rows={4} />}
					{error && (
						<ErrorBanner message={error.message} requestId={error.status >= 500 ? error.requestId : ""} onRetry={reload} />
					)}
					{data &&
						(identical ? (
							<p className="muted">
								{environment.name} already matches {sourceEnvironment.name}.
							</p>
						) : (
							<DiffView diff={data.diff} variations={flag.variations} />
						))}
				</div>
				<footer className="dialog-footer">
					<button className="text-button" disabled={busy} type="button" onClick={onClose}>
						Cancel
					</button>
					<button
						className="primary-button"
						disabled={busy || !data || identical || !allowed}
						title={!allowed ? "Your role cannot promote into this environment." : undefined}
						type="button"
						onClick={() => promote(false)}
					>
						{busy ? "Working…" : viaChangeRequest ? "Propose promotion" : `Promote to ${environment.name}`}
					</button>
				</footer>
			</section>
			{rolloutError && (
				<RolloutActiveDialog
					busy={busy}
					environmentName={environment.name}
					error={rolloutError}
					onCancel={() => setRolloutError(null)}
					onConfirm={() => promote(true)}
				/>
			)}
		</Modal>,
		document.body,
	);
}
