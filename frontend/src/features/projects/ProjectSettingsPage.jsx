import { useState } from "react";
import { ErrorBanner } from "../../shared/components/ErrorBanner.jsx";
import { FormField } from "../../shared/components/FormField.jsx";
import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { Tabs } from "../../shared/components/Tabs.jsx";
import { useToast } from "../../shared/components/Toast.jsx";
import { useProject } from "../../shared/context/ProjectContext.jsx";
import { useSession } from "../../shared/context/SessionContext.jsx";
import { buildPath } from "../../shared/router/match.js";
import { navigate, useRoute } from "../../shared/router/router.js";
import { fieldErrors } from "../../shared/utils/format.js";
import { EnvironmentPolicyTable } from "./EnvironmentPolicyTable.jsx";
import { PeopleRolesTable } from "./PeopleRolesTable.jsx";
import { projectApi } from "./project.api.js";
import { ProjectCreateDialog } from "./ProjectCreateDialog.jsx";

const TABS = [
	{ value: "environments", label: "Environments" },
	{ value: "people", label: "People" },
];

function ProjectDetailsForm({ editable, project, onSaved }) {
	const { notify } = useToast();
	const [name, setName] = useState(project.name);
	const [description, setDescription] = useState(project.description || "");
	const [busy, setBusy] = useState(false);
	const [errors, setErrors] = useState({ fields: {}, message: "" });
	const dirty = name.trim() !== project.name || description.trim() !== (project.description || "");
	const submit = async (event) => {
		event.preventDefault();
		setBusy(true);
		setErrors({ fields: {}, message: "" });
		try {
			await projectApi.update(project.key, { name: name.trim(), description: description.trim() });
			await onSaved();
			notify({ kind: "success", message: "Project details saved." });
		} catch (caught) {
			setErrors(fieldErrors(caught));
		} finally {
			setBusy(false);
		}
	};
	return (
		<form className="editor-section settings-details" onSubmit={submit}>
			<div className="editor-section-header">
				<h3>Details</h3>
				<span className="muted">
					Key <code>{project.key}</code>
				</span>
			</div>
			{errors.message && !Object.keys(errors.fields).length && <ErrorBanner message={errors.message} />}
			<div className="settings-details-grid">
				<FormField error={errors.fields.name} label="Name" required>
					{(props) => (
						<input {...props} disabled={!editable || busy} maxLength={80} required type="text" value={name} onChange={(event) => setName(event.target.value)} />
					)}
				</FormField>
				<FormField error={errors.fields.description} label="Description">
					{(props) => (
						<textarea
							{...props}
							disabled={!editable || busy}
							maxLength={500}
							rows={2}
							value={description}
							onChange={(event) => setDescription(event.target.value)}
						/>
					)}
				</FormField>
			</div>
			{editable && (
				<div className="settings-actions">
					<button className="primary-button" disabled={busy || !dirty || !name.trim()} type="submit">
						{busy ? "Saving…" : "Save details"}
					</button>
				</div>
			)}
		</form>
	);
}

export function ProjectSettingsPage() {
	const { project, reloadProjects } = useProject();
	const { can } = useSession();
	const { query, setQuery } = useRoute();
	const { notify } = useToast();
	const editable = can("project:manage");
	const tab = TABS.some((item) => item.value === query.tab) ? query.tab : "environments";
	const [creating, setCreating] = useState(false);
	const [policyBusy, setPolicyBusy] = useState(false);
	const [policyError, setPolicyError] = useState("");

	const changePolicy = async (patch) => {
		setPolicyBusy(true);
		setPolicyError("");
		try {
			await projectApi.update(project.key, { environments: [patch] });
			await reloadProjects();
			const environment = project.environments.find((candidate) => candidate.key === patch.key);
			notify({
				kind: "success",
				message:
					patch.protected === undefined
						? `${environment.name} now requires ${patch.requiredApprovals} approval${patch.requiredApprovals === 1 ? "" : "s"}.`
						: `${environment.name} is ${patch.protected ? "now protected" : "no longer protected"}.`,
			});
		} catch (caught) {
			setPolicyError(caught.message);
		} finally {
			setPolicyBusy(false);
		}
	};

	return (
		<section className="page settings-page" aria-labelledby="settings-title">
			<header className="page-header">
				<div>
					<h1 id="settings-title">Settings</h1>
					<p className="page-subtitle">Environment policy and workspace roles for {project.name}.</p>
				</div>
				{editable && (
					<button className="tonal-button" type="button" onClick={() => setCreating(true)}>
						<MaterialIcon size={18}>add</MaterialIcon> New project
					</button>
				)}
			</header>
			{!editable && (
				<ErrorBanner
					message="Settings are read-only for your role. Ask an admin to change environment protection, approvals, or roles."
					tone="info"
				/>
			)}
			<Tabs ariaLabel="Settings sections" items={TABS} onChange={(value) => setQuery({ tab: value === "environments" ? "" : value })} value={tab} />
			{tab === "environments" && (
				<>
					<ProjectDetailsForm editable={editable} key={`${project.key}:${project.updatedAt}`} onSaved={reloadProjects} project={project} />
					<section className="editor-section" aria-labelledby="settings-environments-title">
						<div className="editor-section-header">
							<h3 id="settings-environments-title">Environment protection</h3>
							<span className="muted">Protected environments require a reviewed change request for every targeting change.</span>
						</div>
						{policyError && <ErrorBanner message={policyError} />}
						<EnvironmentPolicyTable busy={policyBusy} editable={editable} environments={project.environments} onChange={changePolicy} />
					</section>
				</>
			)}
			{tab === "people" && (
				<section className="editor-section" aria-labelledby="settings-people-title">
					<div className="editor-section-header">
						<h3 id="settings-people-title">People and roles</h3>
						<span className="muted">Roles apply across every project. At least one admin must remain.</span>
					</div>
					<PeopleRolesTable editable={editable} />
				</section>
			)}
			{creating && (
				<ProjectCreateDialog
					onClose={() => setCreating(false)}
					onCreated={async (created) => {
						setCreating(false);
						await reloadProjects();
						notify({ kind: "success", message: `Project ${created.name} created.` });
						navigate(buildPath("settings", { projectKey: created.key }));
					}}
				/>
			)}
		</section>
	);
}
