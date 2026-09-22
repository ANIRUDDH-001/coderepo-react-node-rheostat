import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "../../shared/components/EmptyState.jsx";
import { ErrorBanner } from "../../shared/components/ErrorBanner.jsx";
import { Skeleton } from "../../shared/components/Skeleton.jsx";
import { ProjectProvider, readLastProject, rememberProject } from "../../shared/context/ProjectContext.jsx";
import { useSession } from "../../shared/context/SessionContext.jsx";
import { useAsync } from "../../shared/hooks/useAsync.js";
import { buildPath } from "../../shared/router/match.js";
import { navigate, useRoute } from "../../shared/router/router.js";
import { changeRequestApi } from "../change-requests/change-request.api.js";
import { ChangeRequestDetailPage } from "../change-requests/ChangeRequestDetailPage.jsx";
import { ChangeRequestsPage } from "../change-requests/ChangeRequestsPage.jsx";
import { FlagDetailPage } from "../flags/FlagDetailPage.jsx";
import { FlagsPage } from "../flags/FlagsPage.jsx";
import { PlaygroundPage } from "../playground/PlaygroundPage.jsx";
import { projectApi } from "../projects/project.api.js";
import { RolloutDetailPage } from "../rollouts/RolloutDetailPage.jsx";
import { RolloutsPage } from "../rollouts/RolloutsPage.jsx";
import { rolloutApi } from "../rollouts/rollout.api.js";
import { SegmentEditorPage } from "../segments/SegmentEditorPage.jsx";
import { SegmentsPage } from "../segments/SegmentsPage.jsx";
import { NavRail } from "./NavRail.jsx";
import { TopBar } from "./TopBar.jsx";

const PLACEHOLDERS = {
	dashboard: { title: "Dashboard", description: "The dashboard arrives in a later phase." },
	rollouts: { title: "Rollouts", description: "Progressive rollouts arrive in a later phase." },
	rollout: { title: "Rollout", description: "Progressive rollouts arrive in a later phase." },
	audit: { title: "Audit", description: "The audit feed page arrives in a later phase." },
	settings: { title: "Settings", description: "Project settings arrive in a later phase." },
};

function NotFound({ projectKey }) {
	return (
		<EmptyState
			action={{ label: "Go to flags", onClick: () => navigate(buildPath("flags", { projectKey })) }}
			description="The address does not match anything in Rheostat."
			icon="help_outline"
			title="Page not found"
		/>
	);
}

function RouteSwitch({ project, projects, route }) {
	const { name, params } = route;
	if (name === "flags") return <FlagsPage key={project.key} />;
	if (name === "flag") return <FlagDetailPage flagKey={params.flagKey} key={`${project.key}/${params.flagKey}`} />;
	if (name === "segments") return <SegmentsPage key={project.key} />;
	if (name === "segmentNew") return <SegmentEditorPage key={`${project.key}/new`} segmentKey={null} />;
	if (name === "segment") return <SegmentEditorPage key={`${project.key}/${params.segmentKey}`} segmentKey={params.segmentKey} />;
	if (name === "playground") return <PlaygroundPage key={project.key} />;
	if (name === "changeRequests") return <ChangeRequestsPage key={project.key} />;
	if (name === "changeRequest") return <ChangeRequestDetailPage id={params.id} key={params.id} />;
	if (name === "rollouts") return <RolloutsPage key={project.key} />;
	if (name === "rollout") return <RolloutDetailPage id={params.id} key={params.id} />;
	if (PLACEHOLDERS[name])
		return <EmptyState description={PLACEHOLDERS[name].description} icon="hourglass_empty" title={PLACEHOLDERS[name].title} />;
	return <NotFound projectKey={project?.key || projects[0]?.key} />;
}

export function Workspace({ onLogout, onProfileSwitch }) {
	const { profile } = useSession();
	const route = useRoute();
	const [drawerOpen, setDrawerOpen] = useState(false);
	const { data: projects, error, loading, reload } = useAsync(() => projectApi.list(), []);
	const closeDrawer = useCallback(() => setDrawerOpen(false), []);

	const project = useMemo(() => {
		if (!projects?.length) return null;
		const wanted = route.params.projectKey;
		if (wanted) return projects.find((candidate) => candidate.key === wanted) || null;
		return projects.find((candidate) => candidate.key === readLastProject()) || projects[0];
	}, [projects, route.params.projectKey]);

	// `/` redirects to the remembered (or first) project's flags until the dashboard exists.
	useEffect(() => {
		if (!projects?.length) return;
		if (route.name === "home") navigate(buildPath("flags", { projectKey: project.key }), { replace: true });
	}, [projects, project, route.name]);

	useEffect(() => {
		if (project) rememberProject(project.key);
	}, [project]);

	useEffect(() => {
		document.title = project ? `${project.name} · Rheostat` : "Rheostat";
	}, [project]);

	// Rail badge: change requests waiting on this profile. Re-counted on navigation so it tracks reviews made elsewhere.
	const projectKey = project?.key;
	const badges = useAsync(async () => {
		if (!projectKey) return {};
		const [changeRequests, rollouts] = await Promise.all([
			changeRequestApi.list(projectKey, { pageSize: 1, needsMyReview: "true" }),
			rolloutApi.list(projectKey, { pageSize: 1, status: "active" }),
		]);
		return { pendingChangeRequests: changeRequests.counts.needsMyReview, activeRollouts: rollouts.counts.active };
	}, [projectKey, route.path, profile._id]);

	const reloadBadges = badges.reload;
	const value = useMemo(
		() => ({ project, projects: projects || [], reloadProjects: reload, reloadBadges }),
		[project, projects, reload, reloadBadges],
	);

	let content;
	if (loading && !projects) content = <Skeleton rows={6} />;
	else if (error && !projects) content = <ErrorBanner message={error.message} onRetry={reload} />;
	else if (!projects.length)
		content = <EmptyState description="Ask an admin to create the first project." icon="layers" title="No projects yet" />;
	else if (route.params.projectKey && !project) content = <NotFound projectKey={projects[0].key} />;
	else if (route.name === "home") content = <Skeleton rows={6} />;
	else content = <RouteSwitch project={project} projects={projects} route={route} />;

	return (
		<ProjectProvider value={value}>
			<div className="app-shell">
				<TopBar
					onLogout={onLogout}
					onMenu={() => setDrawerOpen(true)}
					onProfileSwitch={onProfileSwitch}
					profile={profile}
					project={project}
					projects={projects || []}
				/>
				<NavRail
					badges={badges.data || {}}
					currentRoute={route.name}
					onClose={closeDrawer}
					open={drawerOpen}
					projectKey={project?.key || projects?.[0]?.key || ""}
				/>
				<main className="workspace-surface" id="main">
					{content}
				</main>
			</div>
		</ProjectProvider>
	);
}
