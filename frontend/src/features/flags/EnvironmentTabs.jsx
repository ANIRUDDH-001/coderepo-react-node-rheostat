import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { Link } from "../../shared/router/Link.jsx";
import { buildPath } from "../../shared/router/match.js";
import { Tabs } from "../../shared/components/Tabs.jsx";

export function EnvironmentTabs({ actions = null, environment, environments, flag, onEnvironment, onPlan = null, onTab, projectKey, tab }) {
	const rollout = flag.activeRollouts?.[environment.key];
	return (
		<div className="environment-tabs">
			<Tabs
				ariaLabel="Environment"
				className="tabs-environments"
				items={environments.map((candidate) => {
					const summary = flag.environmentSummaries[candidate.key];
					return {
						value: candidate.key,
						label: candidate.name,
						icon: <span className="env-dot" style={{ "--env-color": candidate.color }} aria-hidden="true" />,
						badge: summary.enabled ? "on" : "off",
					};
				})}
				onChange={onEnvironment}
				value={environment.key}
			/>
			<div className="environment-subbar">
				<Tabs
					ariaLabel="Section"
					items={[
						{ value: "targeting", label: "Targeting", icon: <MaterialIcon size={18}>tune</MaterialIcon> },
						{ value: "history", label: "History", icon: <MaterialIcon size={18}>history</MaterialIcon> },
					]}
					onChange={onTab}
					value={tab}
				/>
				<div className="environment-info">
					{rollout ? (
						<Link className="rollout-active-card" to={buildPath("rollout", { projectKey, id: rollout._id })}>
							<MaterialIcon size={16}>timeline</MaterialIcon> Rolling out · {rollout.currentPercent}%
						</Link>
					) : onPlan ? (
						<button className="text-button" type="button" onClick={onPlan}><MaterialIcon size={18}>timeline</MaterialIcon> Plan a rollout</button>
					) : null}
					{environment.protected && (
						<span
							className="protected-note"
							title={`${environment.requiredApprovals} approval${environment.requiredApprovals === 1 ? "" : "s"} required`}
						>
							<MaterialIcon size={16}>lock</MaterialIcon> Protected
						</span>
					)}
					<span className="muted">v{flag.environments[environment.key].version}</span>
					{actions}
				</div>
			</div>
		</div>
	);
}
