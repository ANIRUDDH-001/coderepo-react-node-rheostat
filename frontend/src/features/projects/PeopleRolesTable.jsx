import { useState } from "react";
import { Badge } from "../../shared/components/Badge.jsx";
import { ErrorBanner } from "../../shared/components/ErrorBanner.jsx";
import { SelectMenu } from "../../shared/components/SelectMenu.jsx";
import { Skeleton } from "../../shared/components/Skeleton.jsx";
import { useToast } from "../../shared/components/Toast.jsx";
import { useSession } from "../../shared/context/SessionContext.jsx";
import { useAsync } from "../../shared/hooks/useAsync.js";
import { ROLE_LABELS, roleLabel } from "../../shared/utils/roles.js";
import { peopleApi } from "../people/people.api.js";
import { ProfileAvatar } from "../profiles/ProfileAvatar.jsx";

const ROLE_OPTIONS = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }));
const ROLE_SUMMARY = {
	admin: "Everything, plus project settings and roles",
	releaseManager: "Kill switches, archiving, production rollouts, applying any change",
	reviewer: "Reviews change requests; edits unprotected environments",
	developer: "Creates flags and segments; proposes production changes",
	viewer: "Read-only, including the playground",
};

// Workspace-wide roles (spec §3.2). Only admins change them; the last admin and your own role are guarded server-side.
export function PeopleRolesTable({ editable }) {
	const { profile } = useSession();
	const { notify } = useToast();
	const { data, error, loading, reload, mutate } = useAsync(() => peopleApi.search(""), []);
	const [failure, setFailure] = useState({});
	const [busyId, setBusyId] = useState("");
	if (loading && !data) return <Skeleton rows={5} />;
	if (error && !data) return <ErrorBanner message={error.message} onRetry={reload} />;
	const change = async (person, role) => {
		setBusyId(person._id);
		setFailure((previous) => ({ ...previous, [person._id]: "" }));
		try {
			const updated = await peopleApi.updateRole(person._id, role);
			mutate((people) => people.map((candidate) => (candidate._id === updated._id ? updated : candidate)));
			notify({ kind: "success", message: `${updated.name} is now ${roleLabel(role).toLowerCase()}.` });
		} catch (caught) {
			setFailure((previous) => ({ ...previous, [person._id]: caught.message }));
		} finally {
			setBusyId("");
		}
	};
	return (
		<div className="table-scroll">
			<table className="data-table people-table">
				<thead>
					<tr>
						<th scope="col">Person</th>
						<th scope="col">Role</th>
						<th scope="col">Can</th>
					</tr>
				</thead>
				<tbody>
					{data.map((person) => (
						<tr key={person._id}>
							<td>
								<span className="owner-cell">
									<ProfileAvatar profile={person} size="small" />
									<span className="people-identity">
										<strong>
											{person.name}
											{person._id === profile._id && <Badge tone="accent">You</Badge>}
										</strong>
										<span className="muted">{person.headline || person.email}</span>
									</span>
								</span>
							</td>
							<td>
								{editable ? (
									<>
										<SelectMenu
											ariaLabel={`Role for ${person.name}`}
											className="people-role"
											disabled={busyId === person._id}
											onChange={(role) => {
												if (role !== person.role) change(person, role);
											}}
											options={ROLE_OPTIONS}
											value={person.role}
										/>
										{failure[person._id] && (
											<span className="form-error" role="alert">
												{failure[person._id]}
											</span>
										)}
									</>
								) : (
									<Badge tone={person.role === "admin" ? "accent" : "neutral"}>{roleLabel(person.role)}</Badge>
								)}
							</td>
							<td className="muted">{ROLE_SUMMARY[person.role]}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
