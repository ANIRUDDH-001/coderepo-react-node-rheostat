import { useSession } from "../../shared/context/SessionContext.jsx";
import { roleLabel } from "../../shared/utils/roles.js";
import { TopBar } from "./TopBar.jsx";

export function Workspace({ onLogout, onProfileSwitch }) {
	const { profile, permissions } = useSession();
	return (
		<div className="app-shell">
			<TopBar onLogout={onLogout} onProfileSwitch={onProfileSwitch} profile={profile} />
			<main className="workspace-surface">
				<section className="workspace-intro" aria-labelledby="workspace-intro-title">
					<h1 id="workspace-intro-title">
						{profile.name} · {roleLabel(profile.role)}
					</h1>
					<p>{permissions.length} permissions granted to this profile.</p>
				</section>
			</main>
		</div>
	);
}
