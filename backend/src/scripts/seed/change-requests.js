import { ChangeRequest } from "../../features/change-requests/change-request.model.js";
import { normalizeConfig } from "../../features/flags/config-diff.js";
import { FlagVersion } from "../../features/flags/flag-version.model.js";
import { daysAgo } from "./clock.js";

const on = (id) => ({ variationId: id });
const segmentRule = (id, description, segmentKey, serve) => ({
	id,
	description,
	clauses: [{ attribute: "key", operator: "segmentMatch", values: [segmentKey], negate: false }],
	serve,
});
const config = (enabled, offVariationId, fallthrough, rules = []) => normalizeConfig({ enabled, offVariationId, rules, fallthrough });

const EMAILS = {
	priya: "priya.raman@rheostat.team",
	marcus: "marcus.chen@rheostat.team",
	elena: "elena.novak@rheostat.team",
	diego: "diego.alvarez@rheostat.team",
};

// Six change requests covering every status; comments and reviews carry realistic timestamps.
const rows = [
	{
		flag: "express-returns",
		environment: "production",
		kind: "manual",
		title: "Launch express returns to beta testers",
		description:
			"Beta testers have been on it in staging for a week without a single failed refund. Everyone else stays on the old flow until the CS team is trained.",
		author: "diego",
		createdDaysAgo: 2,
		baseVersion: 1,
		status: "pending",
		proposedConfig: config(true, "v_false", on("v_false"), [
			segmentRule("r_beta", "Beta testers get express returns", "beta-testers", on("v_true")),
		]),
		reviews: [],
		comments: [
			{
				author: "diego",
				daysAgo: 2,
				hour: 11,
				body: "Staging soak looked clean: 412 returns, zero refund failures. Ready for review.",
			},
			{ author: "elena", daysAgo: 1, hour: 15, body: "Looking at it tomorrow morning; can you link the refund dashboard here?" },
		],
	},
	{
		flag: "search-page-size",
		environment: "production",
		kind: "manual",
		title: "Serve 50 results to everyone",
		description:
			"The 50/50 split has run for two weeks. p95 latency is flat and click-through on page two dropped 31%, so the larger page wins.",
		author: "diego",
		createdDaysAgo: 4,
		baseVersion: 3,
		status: "approved",
		proposedConfig: config(true, "v_20", on("v_50"), [
			segmentRule("r_enterprise", "Enterprise accounts get 100 results", "enterprise-plans", on("v_100")),
		]),
		reviews: [
			{ reviewer: "elena", decision: "approve", daysAgo: 3, hour: 10, comment: "Numbers check out. Apply whenever you are ready." },
		],
		comments: [
			{ author: "elena", daysAgo: 3, hour: 10, body: "Approved. Please apply before the weekend so we get a full week of data." },
		],
	},
	{
		flag: "checkout-layout",
		environment: "production",
		kind: "manual",
		title: "Drop the EU compact-layout rule",
		description: "Compact underperforms control for EU shoppers on desktop; revert them to control while we investigate.",
		author: "diego",
		createdDaysAgo: 12,
		baseVersion: 2,
		status: "conflicted",
		proposedConfig: config(true, "v_control", on("v_control"), [
			segmentRule("r_enterprise", "Enterprise accounts get the express layout", "enterprise-plans", on("v_express")),
			segmentRule("r_beta", "Beta testers try the compact layout", "beta-testers", on("v_compact")),
		]),
		reviews: [],
		comments: [
			{
				author: "marcus",
				daysAgo: 9,
				hour: 14,
				body: "I changed production yesterday to add the EU rule; this needs a rebase before anyone reviews it.",
			},
		],
	},
	{
		flag: "biometric-login",
		environment: "production",
		kind: "promotion",
		title: "Promote biometric-login from Staging (v2) to Production",
		description: "",
		author: "marcus",
		createdDaysAgo: 17,
		baseVersion: 1,
		status: "applied",
		sourceEnvironment: "staging",
		sourceVersion: 2,
		appliedVersion: 2,
		appliedBy: "marcus",
		appliedDaysAgo: 16,
		proposedConfig: config(true, "v_false", on("v_false"), [
			segmentRule("r_ios", "iOS on the latest major", "ios-latest", on("v_true")),
		]),
		reviews: [{ reviewer: "elena", decision: "approve", daysAgo: 16, hour: 9, comment: "Matches staging exactly." }],
		comments: [],
	},
	{
		flag: "pricing-banner",
		environment: "production",
		kind: "promotion",
		title: "Promote pricing-banner from Development (v3) to Production",
		description: "",
		author: "diego",
		createdDaysAgo: 8,
		baseVersion: 1,
		status: "rejected",
		sourceEnvironment: "development",
		sourceVersion: 3,
		proposedConfig: config(true, "v_none", on("v_spring"), [
			segmentRule("r_high_value", "High-value customers see the loyalty offer", "high-value", on("v_loyalty")),
		]),
		reviews: [
			{
				reviewer: "elena",
				decision: "reject",
				daysAgo: 7,
				hour: 16,
				comment: "Banner copy needs legal review before it reaches customers.",
			},
		],
		comments: [{ author: "diego", daysAgo: 7, hour: 17, body: "Fair. I will reopen once legal signs off on the discount wording." }],
	},
	{
		flag: "offline-mode",
		environment: "production",
		kind: "manual",
		title: "Enable offline mode for everyone",
		description: "Turn the fallthrough on for all users now that sync conflicts are resolved.",
		author: "diego",
		createdDaysAgo: 6,
		baseVersion: 2,
		status: "withdrawn",
		proposedConfig: config(true, "v_false", on("v_true")),
		reviews: [],
		comments: [
			{ author: "diego", daysAgo: 5, hour: 9, body: "Withdrawing: we will ramp this with a rollout plan instead of a flat switch." },
		],
	},
];

export async function seedChangeRequests(projects, flags, people) {
	console.log("\nSeeding change requests...");
	const person = (name) => people.byEmail.get(EMAILS[name]);
	const documents = [];
	const audit = [];
	for (const row of rows) {
		const flag = flags.byKey.get(row.flag);
		const project = projects.projects.find((candidate) => candidate._id.equals(flag.projectId));
		const environment = project.environments.find((candidate) => candidate.key === row.environment);
		const author = person(row.author);
		const createdAt = daysAgo(row.createdDaysAgo, 10);
		const id = new ChangeRequest()._id;
		const reviews = row.reviews.map((review) => ({
			reviewerId: person(review.reviewer)._id,
			decision: review.decision,
			comment: review.comment,
			at: daysAgo(review.daysAgo, review.hour),
		}));
		const comments = row.comments.map((comment, index) => ({
			id: `c_seed${documents.length}${index}`,
			authorId: person(comment.author)._id,
			body: comment.body,
			at: daysAgo(comment.daysAgo, comment.hour),
		}));
		const timestamps = [createdAt, ...reviews.map((review) => review.at), ...comments.map((comment) => comment.at)];
		const appliedAt = row.status === "applied" ? daysAgo(row.appliedDaysAgo, 11) : null;
		const resolvedAt =
			row.status === "applied"
				? appliedAt
				: ["rejected", "withdrawn"].includes(row.status)
					? daysAgo(row.createdDaysAgo - 1, 9)
					: null;
		const updatedAt = new Date(
			Math.max(...timestamps.map((date) => date.getTime()), appliedAt?.getTime() || 0, resolvedAt?.getTime() || 0),
		);
		documents.push({
			_id: id,
			projectId: project._id,
			flagId: flag._id,
			flagKey: flag.key,
			environment: row.environment,
			kind: row.kind,
			title: row.title,
			description: row.description,
			proposedConfig: row.proposedConfig,
			baseVersion: row.baseVersion,
			sourceEnvironment: row.sourceEnvironment,
			sourceVersion: row.sourceVersion,
			policy: { requiredApprovals: environment.requiredApprovals },
			status: row.status,
			authorId: author._id,
			reviews,
			comments,
			appliedVersion: row.appliedVersion ?? null,
			appliedAt,
			appliedBy: row.appliedBy ? person(row.appliedBy)._id : null,
			resolvedAt,
			createdAt,
			updatedAt,
		});
		const entry = (actor, action, summary, at, metadata = {}) =>
			audit.push({
				projectId: project._id,
				actorId: actor._id,
				action,
				entityType: "changeRequest",
				entityId: String(id),
				entityLabel: row.title,
				summary,
				metadata: { flagKey: flag.key, environment: row.environment, kind: row.kind, ...metadata },
				at,
			});
		entry(
			author,
			"changeRequest.created",
			`${author.name} proposed "${row.title}" for ${flag.key} in ${environment.name}.`,
			createdAt,
			{ baseVersion: row.baseVersion },
		);
		for (const review of row.reviews) {
			const reviewer = person(review.reviewer);
			entry(
				reviewer,
				review.decision === "approve" ? "changeRequest.approved" : "changeRequest.rejected",
				`${reviewer.name} ${review.decision === "approve" ? "approved" : "rejected"} "${row.title}": ${review.comment}`,
				daysAgo(review.daysAgo, review.hour),
				{ comment: review.comment },
			);
		}
		for (const [index, comment] of row.comments.entries()) {
			const commenter = person(comment.author);
			entry(
				commenter,
				"changeRequest.commented",
				`${commenter.name} commented on "${row.title}".`,
				daysAgo(comment.daysAgo, comment.hour),
				{ commentId: comments[index].id },
			);
		}
		if (row.status === "applied") {
			const applier = person(row.appliedBy);
			entry(
				applier,
				"changeRequest.applied",
				`${applier.name} applied "${row.title}" to ${flag.key} in ${environment.name} (v${row.appliedVersion}).`,
				appliedAt,
				{ appliedVersion: row.appliedVersion },
			);
			await FlagVersion.updateOne(
				{ flagId: flag._id, environment: row.environment, version: row.appliedVersion },
				{ $set: { changeRequestId: id } },
			);
		}
		if (row.status === "withdrawn") entry(author, "changeRequest.withdrawn", `${author.name} withdrew "${row.title}".`, resolvedAt);
		if (row.status === "conflicted") {
			entry(
				person("marcus"),
				"changeRequest.conflicted",
				`"${row.title}" conflicts with a newer version of ${flag.key} in ${row.environment}.`,
				daysAgo(10, 11),
				{ baseVersion: row.baseVersion },
			);
		}
	}
	const created = await ChangeRequest.insertMany(documents);
	console.log(`  Created ${created.length} change requests`);
	return { changeRequests: created, audit };
}
