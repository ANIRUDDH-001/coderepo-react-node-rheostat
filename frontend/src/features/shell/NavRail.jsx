import { useEffect } from "react";
import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { Link } from "../../shared/router/Link.jsx";
import { buildPath } from "../../shared/router/match.js";

export const NAV_ITEMS = [
	{ route: "dashboard", label: "Dashboard", icon: "dashboard" },
	{ route: "flags", label: "Flags", icon: "flag" },
	{ route: "segments", label: "Segments", icon: "group" },
	{ route: "changeRequests", label: "Change requests", icon: "rate_review", badge: "pendingChangeRequests" },
	{ route: "rollouts", label: "Rollouts", icon: "timeline", badge: "activeRollouts" },
	{ route: "playground", label: "Playground", icon: "science" },
	{ route: "audit", label: "Audit", icon: "history" },
	{ route: "settings", label: "Settings", icon: "settings" },
];

const SECTION_OF = { flag: "flags", segment: "segments", segmentNew: "segments", changeRequest: "changeRequests", rollout: "rollouts" };

export function NavRail({ badges = {}, currentRoute, onClose, open, projectKey }) {
	useEffect(() => {
		if (!open) return undefined;
		const onKey = (event) => {
			if (event.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open, onClose]);
	const active = SECTION_OF[currentRoute] || currentRoute;
	return (
		<>
			{open && <div aria-hidden="true" className="nav-scrim" onClick={onClose} />}
			<nav aria-label="Primary" className={open ? "nav-rail nav-rail-open" : "nav-rail"}>
				<ul>
					{NAV_ITEMS.map((item) => {
						const count = item.badge ? badges[item.badge] || 0 : 0;
						return (
							<li key={item.route}>
								<Link
									aria-current={active === item.route ? "page" : undefined}
									className={active === item.route ? "nav-link nav-link-active" : "nav-link"}
									title={item.label}
									to={buildPath(item.route, { projectKey })}
									onClick={onClose}
								>
									<MaterialIcon size={22}>{item.icon}</MaterialIcon>
									<span className="nav-label">{item.label}</span>
									{count > 0 && <span className="nav-badge">{count}</span>}
								</Link>
							</li>
						);
					})}
				</ul>
			</nav>
		</>
	);
}
