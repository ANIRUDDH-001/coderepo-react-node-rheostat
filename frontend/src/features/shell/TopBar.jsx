import { useState } from "react";
import { BrandMark } from "../../shared/components/BrandMark.jsx";
import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { buildPath } from "../../shared/router/match.js";
import { navigate } from "../../shared/router/router.js";
import { ProjectSwitcher } from "../projects/ProjectSwitcher.jsx";
import { ProfileMenu } from "./ProfileMenu.jsx";

export function TopBar({ onLogout, onMenu, onProfileSwitch, profile, project, projects }) {
	const [search, setSearch] = useState("");
	const submit = (event) => {
		event.preventDefault();
		if (!project) return;
		navigate(buildPath("flags", { projectKey: project.key }, { query: search.trim() }));
	};
	return (
		<header className="app-header">
			<button aria-label="Open navigation" className="icon-button nav-menu-button" type="button" onClick={onMenu}>
				<MaterialIcon size={24}>menu</MaterialIcon>
			</button>
			<div className="brand">
				<BrandMark />
				<span>Rheostat</span>
			</div>
			{projects.length > 0 && <ProjectSwitcher project={project} projects={projects} />}
			<form className="global-search" role="search" onSubmit={submit}>
				<MaterialIcon size={20}>search</MaterialIcon>
				<input
					aria-label="Search flags"
					placeholder="Search flags"
					type="search"
					value={search}
					onChange={(event) => setSearch(event.target.value)}
				/>
			</form>
			<div className="header-actions">
				<ProfileMenu onLogout={onLogout} onProfileSwitch={onProfileSwitch} profile={profile} />
			</div>
		</header>
	);
}
