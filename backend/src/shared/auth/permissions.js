import { AppError } from "../errors/app-error.js";

export const ROLES = ["admin", "releaseManager", "reviewer", "developer", "viewer"];

const EVERYONE = ROLES;
const CONTRIBUTORS = ["admin", "releaseManager", "reviewer", "developer"];
const REVIEWERS = ["admin", "releaseManager", "reviewer"];
const RELEASE = ["admin", "releaseManager"];
const ADMINS = ["admin"];

// Base grants. Context-aware actions are refined in `can`.
export const PERMISSIONS = {
	"project:read": EVERYONE,
	"flag:read": EVERYONE,
	"segment:read": EVERYONE,
	"changeRequest:read": EVERYONE,
	"rollout:read": EVERYONE,
	"audit:read": EVERYONE,
	"dashboard:read": EVERYONE,
	"playground:evaluate": EVERYONE,
	"savedView:manageOwn": EVERYONE,
	"flag:create": CONTRIBUTORS,
	"flag:editMetadata": CONTRIBUTORS,
	"flag:editConfig": CONTRIBUTORS,
	"segment:manage": CONTRIBUTORS,
	"changeRequest:create": CONTRIBUTORS,
	"changeRequest:comment": CONTRIBUTORS,
	"changeRequest:editOwn": CONTRIBUTORS,
	"changeRequest:withdrawOwn": CONTRIBUTORS,
	"changeRequest:apply": CONTRIBUTORS,
	"rollout:manage": CONTRIBUTORS,
	"changeRequest:review": REVIEWERS,
	"flag:killSwitch": RELEASE,
	"flag:archive": RELEASE,
	"flag:restore": RELEASE,
	"changeRequest:withdrawAny": RELEASE,
	"project:manage": ADMINS,
	"people:manageRoles": ADMINS,
};

const granted = (role, action) => Boolean(PERMISSIONS[action]?.includes(role));

export function can(role, action, context = {}) {
	if (!granted(role, action)) return false;
	const isProtected = context.environment?.protected;
	if (action === "flag:editConfig") return isProtected === false;
	if (action === "rollout:manage") return isProtected === false || (isProtected === true && RELEASE.includes(role));
	if (action === "changeRequest:apply") return Boolean(context.isAuthor) || RELEASE.includes(role);
	return true;
}

export function assertCan(profile, action, context = {}) {
	if (!can(profile?.role, action, context)) {
		throw new AppError(403, "FORBIDDEN", "Your role does not allow this action.", { action });
	}
}

const CONTEXT_ACTIONS = new Set(["flag:editConfig", "rollout:manage", "changeRequest:apply"]);

export function permissionsFor(role) {
	if (!ROLES.includes(role)) return [];
	const list = Object.keys(PERMISSIONS).filter((action) => !CONTEXT_ACTIONS.has(action) && granted(role, action));
	if (can(role, "flag:editConfig", { environment: { protected: false } })) list.push("flag:editConfig:unprotected");
	if (can(role, "rollout:manage", { environment: { protected: false } })) list.push("rollout:manage:unprotected");
	if (can(role, "rollout:manage", { environment: { protected: true } })) list.push("rollout:manage:protected");
	if (can(role, "changeRequest:apply", { isAuthor: true })) list.push("changeRequest:applyOwn");
	if (can(role, "changeRequest:apply", { isAuthor: false })) list.push("changeRequest:applyAny");
	return list;
}
