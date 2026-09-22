import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "../../shared/components/EmptyState.jsx";
import { ErrorBanner } from "../../shared/components/ErrorBanner.jsx";
import { ErrorBoundary, RouteErrorFallback } from "../../shared/components/ErrorBoundary.jsx";
import { Skeleton } from "../../shared/components/Skeleton.jsx";
import { ProjectProvider, readLastProject, rememberProject } from "../../shared/context/ProjectContext.jsx";
import { useSession } from "../../shared/context/SessionContext.jsx";
import { useAsync } from "../../shared/hooks/useAsync.js";
import { buildPath } from "../../shared/router/match.js";
import { navigate, useRoute } from "../../shared/router/router.js";
import { changeRequestApi } from "../change-requests/change-request.api.js";
import { projectApi } from "../projects/project.api.js";
import { rolloutApi } from "../rollouts/rollout.api.js";
import { NavRail } from "./NavRail.jsx";
import { TopBar } from "./TopBar.jsx";

// Every routed page is its own chunk (hardening spec §4); the boundary above Suspense catches a failed chunk load.
const page = (load, name) => lazy(() => load().then((module) => ({ default: module[name] })));
const DashboardPage = page(() => import("../dashboard/DashboardPage.jsx"), "DashboardPage");
const FlagsPage = page(() => import("../flags/FlagsPage.jsx"), "FlagsPage");
const FlagDetailPage = page(() => import("../flags/FlagDetailPage.jsx"), "FlagDetailPage");
const SegmentsPage = page(() => import("../segments/SegmentsPage.jsx"), "SegmentsPage");
const SegmentEditorPage = page(() => import("../segments/SegmentEditorPage.jsx"), "SegmentEditorPage");
const PlaygroundPage = page(() => import("../playground/PlaygroundPage.jsx"), "PlaygroundPage");
const ChangeRequestsPage = page(() => import("../change-requests/ChangeRequestsPage.jsx"), "ChangeRequestsPage");
const ChangeRequestDetailPage = page(() => import("../change-requests/ChangeRequestDetailPage.jsx"), "ChangeRequestDetailPage");
const RolloutsPage = page(() => import("../rollouts/RolloutsPage.jsx"), "RolloutsPage");
const RolloutDetailPage = page(() => import("../rollouts/RolloutDetailPage.jsx"), "RolloutDetailPage");
const AuditPage = page(() => import("../audit/AuditPage.jsx"), "AuditPage");
const ProjectSettingsPage = page(() => import("../projects/ProjectSettingsPage.jsx"), "ProjectSettingsPage");
const WebhookDetailPage = page(() => import("../webhooks/WebhookDetailPage.jsx"), "WebhookDetailPage");

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
	if (name === "dashboard") return <DashboardPage key={project.key} />;
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
	if (name === "audit") return <AuditPage key={project.key} />;
	if (name === "settings") return <ProjectSettingsPage key={project.key} />;
	if (name === "webhook") return <WebhookDetailPage id={params.id} key={params.id} />;
	return <NotFound projectKey={project?.key || projects[0]?.key} />;
}

export function Workspace({ onLogout, onProfileSwitch }) {
	const { profile } = useSession();
	const route = useRoute();
	const [drawerOpen, setDrawerOpen] = useState(false);
	const { data: projects, error, loading, reload } = useAsync(() => projectApi.list(), [], { key: "projects" });
	const closeDrawer = useCallback(() => setDrawerOpen(false), []);

	const project = useMemo(() => {
		if (!projects?.length) return null;
		const wanted = route.params.projectKey;
		if (wanted) return projects.find((candidate) => candidate.key === wanted) || null;
		return projects.find((candidate) => candidate.key === readLastProject()) || projects[0];
	}, [projects, route.params.projectKey]);

	// `/` redirects to the remembered (or first) project's dashboard.
	useEffect(() => {
		if (!projects?.length) return;
		if (route.name === "home") navigate(buildPath("dashboard", { projectKey: project.key }), { replace: true });
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
	else if (error && !projects)
		content = <ErrorBanner message={error.message} requestId={error.status >= 500 ? error.requestId : ""} onRetry={reload} />;
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
					<ErrorBoundary
						fallback={(error, reset) => (
							<RouteErrorFallback error={error} onRetry={reset} projectKey={project?.key || projects?.[0]?.key || ""} />
						)}
						resetKeys={[route.path]}
					>
						<Suspense fallback={<Skeleton rows={6} />}>{content}</Suspense>
					</ErrorBoundary>
				</main>
			</div>
		</ProjectProvider>
	);
}
