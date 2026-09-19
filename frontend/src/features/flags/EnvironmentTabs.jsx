import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { Tabs } from "../../shared/components/Tabs.jsx";

export function EnvironmentTabs({ actions = null, environment, environments, flag, onEnvironment, onTab, tab }) {
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
					{environment.protected && (
						<span className="protected-note" title={`${environment.requiredApprovals} approval${environment.requiredApprovals === 1 ? "" : "s"} required`}>
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
