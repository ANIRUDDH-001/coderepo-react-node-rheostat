// Pure change-request state machine (spec §5.3). No persistence; the service applies the result.
import { AppError } from "../../shared/errors/app-error.js";
import { can } from "../../shared/auth/permissions.js";

export const STATUSES = ["pending", "approved", "conflicted", "applied", "rejected", "withdrawn"];
export const TERMINAL = new Set(["applied", "rejected", "withdrawn"]);
export const KINDS = ["manual", "promotion", "rollback"];

const invalid = (message) => new AppError(422, "INVALID_TRANSITION", message);
const forbidden = (action) => new AppError(403, "FORBIDDEN", "Your role does not allow this action.", { action });

const isAuthor = (changeRequest, actor) => String(changeRequest.authorId) === String(actor._id);
const approvals = (reviews) => reviews.filter((review) => review.decision === "approve").length;

const assertOpen = (changeRequest, allowed) => {
	if (TERMINAL.has(changeRequest.status)) throw invalid(`A ${changeRequest.status} change request cannot change.`);
	if (!allowed.includes(changeRequest.status)) throw invalid(`This action is not available while the request is ${changeRequest.status}.`);
};

const review = (changeRequest, actor, now, decision, comment, currentVersion) => {
	assertOpen(changeRequest, ["pending"]);
	if (!can(actor.role, "changeRequest:review")) throw forbidden("changeRequest:review");
	if (isAuthor(changeRequest, actor)) throw new AppError(403, "SELF_REVIEW_FORBIDDEN", "Authors cannot review their own change request.");
	if (changeRequest.reviews.some((entry) => String(entry.reviewerId) === String(actor._id))) {
		throw new AppError(409, "ALREADY_REVIEWED", "You have already reviewed this change request.");
	}
	if (currentVersion !== undefined && changeRequest.baseVersion !== currentVersion) {
		throw new AppError(409, "VERSION_CONFLICT", "The target environment changed since this request was made. It needs a rebase before review.");
	}
	const reviews = [...changeRequest.reviews, { reviewerId: actor._id, decision, comment: comment || "", at: now }];
	if (decision === "reject") return { ...changeRequest, reviews, status: "rejected", resolvedAt: now };
	const status = approvals(reviews) >= (changeRequest.policy?.requiredApprovals || 1) ? "approved" : "pending";
	return { ...changeRequest, reviews, status };
};

export function transition(changeRequest, action, actor, now, context = {}) {
	switch (action) {
		case "create": {
			if (!can(actor.role, "changeRequest:create")) throw forbidden("changeRequest:create");
			return { ...changeRequest, status: "pending", authorId: actor._id, baseVersion: context.currentVersion, reviews: [], comments: changeRequest.comments || [] };
		}
		case "approve":
			return review(changeRequest, actor, now, "approve", context.comment, context.currentVersion);
		case "reject":
			return review(changeRequest, actor, now, "reject", context.comment, context.currentVersion);
		case "edit": {
			assertOpen(changeRequest, ["pending", "approved", "conflicted"]);
			if (!isAuthor(changeRequest, actor)) throw forbidden("changeRequest:editOwn");
			return { ...changeRequest, ...(context.patch || {}), status: "pending", reviews: [], baseVersion: context.currentVersion };
		}
		case "rebase": {
			assertOpen(changeRequest, ["conflicted"]);
			if (!isAuthor(changeRequest, actor)) throw forbidden("changeRequest:editOwn");
			return { ...changeRequest, status: "pending", reviews: [], baseVersion: context.currentVersion };
		}
		case "apply": {
			assertOpen(changeRequest, ["approved"]);
			if (!can(actor.role, "changeRequest:apply", { isAuthor: isAuthor(changeRequest, actor) })) throw forbidden("changeRequest:apply");
			if (changeRequest.baseVersion !== context.currentVersion) return { ...changeRequest, status: "conflicted" };
			return { ...changeRequest, status: "applied", appliedVersion: context.appliedVersion, appliedBy: actor._id, appliedAt: now, resolvedAt: now };
		}
		case "withdraw": {
			assertOpen(changeRequest, ["pending", "approved", "conflicted"]);
			const allowed = (isAuthor(changeRequest, actor) && can(actor.role, "changeRequest:withdrawOwn")) || can(actor.role, "changeRequest:withdrawAny");
			if (!allowed) throw forbidden("changeRequest:withdraw");
			return { ...changeRequest, status: "withdrawn", resolvedAt: now };
		}
		default:
			throw invalid(`Unknown action ${action}.`);
	}
}

// Run on read: a pending or approved request whose base drifted is conflicted (spec §5.3).
export function detectStale(changeRequest, currentVersion) {
	if (["pending", "approved"].includes(changeRequest.status) && changeRequest.baseVersion !== currentVersion) {
		return { ...changeRequest, status: "conflicted" };
	}
	return changeRequest;
}

export const canComment = (status) => STATUSES.includes(status);
