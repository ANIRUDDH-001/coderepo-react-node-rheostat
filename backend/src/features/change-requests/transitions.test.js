import { describe, expect, test } from "bun:test";
import { canComment, detectStale, STATUSES, transition } from "./transitions.js";

const now = new Date("2026-09-19T10:00:00Z");
const author = { _id: "author", role: "developer" };
const reviewer = { _id: "reviewer", role: "reviewer" };
const secondReviewer = { _id: "reviewer2", role: "reviewer" };
const manager = { _id: "manager", role: "releaseManager" };
const viewer = { _id: "viewer", role: "viewer" };

const base = (overrides = {}) => ({
	status: "pending",
	authorId: "author",
	baseVersion: 3,
	policy: { requiredApprovals: 1 },
	reviews: [],
	proposedConfig: { enabled: true },
	...overrides,
});

const expectError = (fn, status, code) => {
	try {
		fn();
		throw new Error("expected to throw");
	} catch (error) {
		expect(error.statusCode).toBe(status);
		expect(error.code).toBe(code);
	}
};

describe("transition: create", () => {
	test("author with changeRequest:create starts pending", () => {
		const created = transition({ ...base(), status: undefined }, "create", author, now, { currentVersion: 3 });
		expect(created.status).toBe("pending");
		expect(created.baseVersion).toBe(3);
		expect(created.reviews).toEqual([]);
	});

	test("viewer cannot create", () => {
		expectError(() => transition(base(), "create", viewer, now, { currentVersion: 3 }), 403, "FORBIDDEN");
	});
});

describe("transition: review", () => {
	test("approve reaches approved when the threshold is met", () => {
		const next = transition(base(), "approve", reviewer, now, { currentVersion: 3, comment: "LGTM" });
		expect(next.status).toBe("approved");
		expect(next.reviews).toEqual([{ reviewerId: "reviewer", decision: "approve", comment: "LGTM", at: now }]);
	});

	test("approve stays pending until requiredApprovals is reached", () => {
		const first = transition(base({ policy: { requiredApprovals: 2 } }), "approve", reviewer, now, { currentVersion: 3 });
		expect(first.status).toBe("pending");
		const second = transition(first, "approve", secondReviewer, now, { currentVersion: 3 });
		expect(second.status).toBe("approved");
	});

	test("reject is immediate", () => {
		const next = transition(base(), "reject", reviewer, now, { currentVersion: 3, comment: "Needs legal review" });
		expect(next.status).toBe("rejected");
		expect(next.resolvedAt).toEqual(now);
	});

	test("author cannot review their own request", () => {
		expectError(
			() => transition(base(), "approve", { ...author, role: "reviewer" }, now, { currentVersion: 3 }),
			403,
			"SELF_REVIEW_FORBIDDEN",
		);
	});

	test("a reviewer may review only once", () => {
		const first = transition(base({ policy: { requiredApprovals: 2 } }), "approve", reviewer, now, { currentVersion: 3 });
		expectError(() => transition(first, "approve", reviewer, now, { currentVersion: 3 }), 409, "ALREADY_REVIEWED");
	});

	test("roles without changeRequest:review are forbidden", () => {
		expectError(() => transition(base(), "approve", { _id: "dev2", role: "developer" }, now, { currentVersion: 3 }), 403, "FORBIDDEN");
	});

	test("reviewing an approved request is an invalid transition", () => {
		expectError(
			() => transition(base({ status: "approved" }), "approve", reviewer, now, { currentVersion: 3 }),
			422,
			"INVALID_TRANSITION",
		);
	});

	test("reviewing a stale request fails with the conflict", () => {
		expectError(() => transition(base(), "approve", reviewer, now, { currentVersion: 4 }), 409, "VERSION_CONFLICT");
	});
});

describe("transition: edit and rebase", () => {
	test("edit by the author clears reviews and refreshes the base version", () => {
		const approved = transition(base(), "approve", reviewer, now, { currentVersion: 3 });
		const edited = transition(approved, "edit", author, now, { currentVersion: 5, patch: { title: "New title" } });
		expect(edited.status).toBe("pending");
		expect(edited.reviews).toEqual([]);
		expect(edited.baseVersion).toBe(5);
		expect(edited.title).toBe("New title");
	});

	test("edit by someone else is forbidden", () => {
		expectError(() => transition(base(), "edit", reviewer, now, { currentVersion: 3, patch: {} }), 403, "FORBIDDEN");
	});

	test("rebase from conflicted returns to pending on the current version", () => {
		const rebased = transition(
			base({ status: "conflicted", reviews: [{ reviewerId: "reviewer", decision: "approve" }] }),
			"rebase",
			author,
			now,
			{ currentVersion: 6 },
		);
		expect(rebased).toMatchObject({ status: "pending", baseVersion: 6, reviews: [] });
	});

	test("rebase from pending is invalid", () => {
		expectError(() => transition(base(), "rebase", author, now, { currentVersion: 3 }), 422, "INVALID_TRANSITION");
	});
});

describe("transition: apply", () => {
	test("author applies an approved request whose base matches", () => {
		const applied = transition(base({ status: "approved" }), "apply", author, now, { currentVersion: 3, appliedVersion: 4 });
		expect(applied).toMatchObject({ status: "applied", appliedVersion: 4, appliedBy: "author", appliedAt: now, resolvedAt: now });
	});

	test("release manager applies someone else's request", () => {
		expect(transition(base({ status: "approved" }), "apply", manager, now, { currentVersion: 3, appliedVersion: 4 }).status).toBe(
			"applied",
		);
	});

	test("another developer cannot apply", () => {
		expectError(
			() => transition(base({ status: "approved" }), "apply", { _id: "dev2", role: "developer" }, now, { currentVersion: 3 }),
			403,
			"FORBIDDEN",
		);
	});

	test("apply with a mismatched base moves to conflicted", () => {
		const conflicted = transition(base({ status: "approved" }), "apply", author, now, { currentVersion: 4 });
		expect(conflicted.status).toBe("conflicted");
	});

	test("apply from pending is invalid", () => {
		expectError(() => transition(base(), "apply", author, now, { currentVersion: 3 }), 422, "INVALID_TRANSITION");
	});
});

describe("transition: withdraw", () => {
	test("author withdraws; release manager withdraws any; reviewer cannot", () => {
		expect(transition(base(), "withdraw", author, now, {}).status).toBe("withdrawn");
		expect(transition(base({ status: "approved" }), "withdraw", manager, now, {}).status).toBe("withdrawn");
		expect(transition(base({ status: "conflicted" }), "withdraw", author, now, {}).status).toBe("withdrawn");
		expectError(() => transition(base(), "withdraw", reviewer, now, {}), 403, "FORBIDDEN");
	});
});

describe("detectStale and terminal states", () => {
	test("detectStale moves pending and approved requests whose base drifted", () => {
		expect(detectStale(base(), 4).status).toBe("conflicted");
		expect(detectStale(base({ status: "approved" }), 4).status).toBe("conflicted");
		expect(detectStale(base(), 3).status).toBe("pending");
		expect(detectStale(base({ status: "applied" }), 9).status).toBe("applied");
	});

	test("terminal states reject every action", () => {
		for (const status of ["applied", "rejected", "withdrawn"]) {
			for (const action of ["approve", "reject", "edit", "apply", "rebase", "withdraw"]) {
				expectError(
					() => transition(base({ status }), action, manager, now, { currentVersion: 3, patch: {} }),
					422,
					"INVALID_TRANSITION",
				);
			}
		}
	});

	test("comments are allowed in every state", () => {
		for (const status of STATUSES) expect(canComment(status)).toBe(true);
	});
});
