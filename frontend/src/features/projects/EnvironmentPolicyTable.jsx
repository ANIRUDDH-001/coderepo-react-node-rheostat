import { useState } from "react";
import { ConfirmationDialog } from "../../shared/components/ConfirmationDialog.jsx";
import { SelectMenu } from "../../shared/components/SelectMenu.jsx";

const APPROVAL_OPTIONS = [1, 2, 3].map((count) => ({ value: String(count), label: `${count} approval${count === 1 ? "" : "s"}` }));

// Environment protection policy. Unprotecting production is the one change that asks for confirmation, because
// it lets any contributor write to production directly.
export function EnvironmentPolicyTable({ busy, editable, environments, onChange }) {
	const [confirm, setConfirm] = useState(null);
	const toggle = (environment, next) => {
		if (!next && environment.key === "production") {
			setConfirm(environment);
			return;
		}
		onChange({ key: environment.key, protected: next });
	};
	return (
		<>
			<div className="table-scroll">
				<table className="data-table policy-table">
					<thead>
						<tr>
							<th scope="col">Environment</th>
							<th scope="col">Protected</th>
							<th scope="col">Required approvals</th>
							<th scope="col">What it means</th>
						</tr>
					</thead>
					<tbody>
						{environments.map((environment) => (
							<tr key={environment.key}>
								<td>
									<span className="environment-name">
										<i className="environment-dot" style={{ background: environment.color }} aria-hidden="true" />
										{environment.name}
									</span>
								</td>
								<td>
									<label className="switch">
										<input
											aria-label={`Protect ${environment.name}`}
											checked={environment.protected}
											disabled={!editable || busy}
											type="checkbox"
											onChange={(event) => toggle(environment, event.target.checked)}
										/>
										<span className="switch-track" aria-hidden="true" />
										<span className="switch-label">{environment.protected ? "On" : "Off"}</span>
									</label>
								</td>
								<td>
									<SelectMenu
										ariaLabel={`Required approvals for ${environment.name}`}
										className="policy-approvals"
										disabled={!editable || busy || !environment.protected}
										onChange={(value) => onChange({ key: environment.key, requiredApprovals: Number(value) })}
										options={APPROVAL_OPTIONS}
										value={String(environment.requiredApprovals)}
									/>
								</td>
								<td className="muted">
									{environment.protected
										? `Targeting changes go through a change request with ${environment.requiredApprovals} approval${
												environment.requiredApprovals === 1 ? "" : "s"
											}. Rollouts need a release manager.`
										: "Contributors save targeting directly. Rollouts can be planned by any contributor."}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{confirm && (
				<ConfirmationDialog
					busy={busy}
					confirmLabel="Remove protection"
					message={`Anyone with edit rights will be able to change ${confirm.name} targeting without review, and open change requests for it will still apply. Re-protect it at any time.`}
					onCancel={() => setConfirm(null)}
					onConfirm={async () => {
						await onChange({ key: confirm.key, protected: false });
						setConfirm(null);
					}}
					title={`Remove protection from ${confirm.name}?`}
				/>
			)}
		</>
	);
}
