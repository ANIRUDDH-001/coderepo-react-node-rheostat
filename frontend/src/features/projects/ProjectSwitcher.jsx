import { SelectMenu } from "../../shared/components/SelectMenu.jsx";
import { rememberProject } from "../../shared/context/ProjectContext.jsx";
import { buildPath, matchRoute } from "../../shared/router/match.js";
import { navigate } from "../../shared/router/router.js";

// Switching projects keeps the current page kind (flags stay on flags) but drops entity-specific params.
const SECTION_ROUTES = new Set(["dashboard", "flags", "segments", "changeRequests", "rollouts", "playground", "audit", "settings"]);
const PARENT = { flag: "flags", segment: "segments", segmentNew: "segments", changeRequest: "changeRequests", rollout: "rollouts" };

export function ProjectSwitcher({ project, projects }) {
	const options = projects.map((candidate) => ({ value: candidate.key, label: candidate.name }));
	return (
		<SelectMenu
			ariaLabel="Project"
			className="project-switcher"
			onChange={(key) => {
				if (key === project?.key) return;
				rememberProject(key);
				const current = matchRoute(window.location.pathname).name;
				const section = SECTION_ROUTES.has(current) ? current : PARENT[current] || "flags";
				navigate(buildPath(section, { projectKey: key }));
			}}
			options={options}
			value={project?.key}
		/>
	);
}
