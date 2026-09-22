import { describe, expect, test } from "bun:test";
import { appliedKey, createReconciler } from "./reconcile.js";

const NOW = new Date("2026-09-19T10:00:00Z");
const minutesAgo = (minutes) => new Date(NOW.getTime() - minutes * 60000);
const flagTemplate = () => ({
	_id: "flag1",
	projectId: "proj1",
	key: "new-checkout",
	killSwitch: { active: false },
	variations: [
		{ id: "v_off", name: "Legacy" },
		{ id: "v_on", name: "New" },
	],
	environments: {
		production: { version: 3, enabled: true, offVariationId: "v_off", rules: [], fallthrough: { variationId: "v_off" } },
	},
});
const planTemplate = (overrides = {}) => ({
	_id: "plan1",
	flagId: "flag1",
	environment: "production",
	targetVariationId: "v_on",
	baselineVariationId: "v_off",
	bucketBy: "key",
	status: "scheduled",
	expectedVersion: 3,
	createdBy: "marcus",
	steps: [
		{ id: "s1", percent: 10, startAt: minutesAgo(5), status: "pending" },
		{ id: "s2", percent: 50, startAt: new Date(NOW.getTime() + 3600000), status: "pending" },
	],
	...overrides,
});

// In-memory fakes with the same guarantees as the repositories: claims match only pending steps,
// the environment write is version-guarded, and the version store has a unique (plan, step) index.
function harness({ plan = planTemplate(), flag = flagTemplate(), failWriteOnce = false } = {}) {
	const state = { plans: [structuredClone(plan)], flag: structuredClone(flag), versions: [], audit: [], events: [], failWriteOnce };
	const find = (id) => state.plans.find((entry) => entry._id === id);
	const stepOf = (id, stepId) => find(id).steps.find((step) => step.id === stepId);
	const plans = {
		findDue: async (now) =>
			state.plans
				.filter((entry) => ["scheduled", "running"].includes(entry.status))
				.filter((entry) => entry.steps.some((step) => step.status === "pending" && step.startAt <= now))
				.map((entry) => structuredClone(entry)),
		findStaleClaims: async (before) =>
			state.plans
				.filter((entry) => entry.steps.some((step) => step.status === "applying" && step.claimedAt < before))
				.map((entry) => structuredClone(entry)),
		claimStep: async (id, stepId, at) => {
			const step = stepOf(id, stepId);
			if (step.status !== "pending") return false;
			step.status = "applying";
			step.claimedAt = at;
			return true;
		},
		releaseStep: async (id, stepId) => {
			const step = stepOf(id, stepId);
			step.status = "pending";
			delete step.claimedAt;
		},
		markApplied: async (id, stepId, version, at) => {
			const entry = find(id);
			const step = stepOf(id, stepId);
			step.status = "applied";
			step.appliedVersion = version;
			step.appliedAt = at;
			delete step.claimedAt;
			entry.expectedVersion = version;
			entry.lastAppliedStepId = stepId;
			entry.status = "running";
			return structuredClone(entry);
		},
		stall: async (id, reason) => {
			const entry = find(id);
			entry.status = "stalled";
			entry.stallReason = reason;
		},
		complete: async (id) => {
			find(id).status = "completed";
		},
	};
	const flags = {
		findById: async () => structuredClone(state.flag),
		mutateEnvironment: async (flagId, env, expectedVersion, fields, actorId, now) => {
			if (state.failWriteOnce) {
				state.failWriteOnce = false;
				return null;
			}
			const config = state.flag.environments[env];
			if (config.version !== expectedVersion) return null;
			Object.assign(config, fields, { version: config.version + 1, lastChangedBy: actorId, lastEffectiveChangeAt: now });
			return structuredClone(state.flag);
		},
		currentConfig: async (flagId, env) => structuredClone(state.flag.environments[env]),
	};
	const versions = {
		insert: async (doc) => {
			if (state.versions.some((entry) => entry.rolloutPlanId === doc.rolloutPlanId && entry.stepId === doc.stepId)) {
				throw Object.assign(new Error("duplicate"), { code: 11000 });
			}
			state.versions.push(structuredClone(doc));
			return doc;
		},
		findByStep: async (planId, stepId) =>
			state.versions.find((entry) => entry.rolloutPlanId === planId && entry.stepId === stepId) || null,
	};
	const audit = {
		recordOnce: async (entry) => {
			if (state.audit.some((existing) => existing.idempotencyKey === entry.idempotencyKey)) return null;
			state.audit.push(entry);
			return entry;
		},
	};
	const events = { emit: async (input) => state.events.push(input) };
	const reconciler = createReconciler({ plans, flags, versions, audit, events });
	return { state, reconciler, plans, flags, versions, audit, events, plan: () => find(plan._id) };
}

describe("reconcileDue — due steps", () => {
	test("applies a due step, snapshots it, audits once, and advances expectedVersion", async () => {
		const h = harness();
		await h.reconciler.reconcileDue(NOW);
		const plan = h.plan();
		expect(plan.status).toBe("running");
		expect(plan.steps[0].status).toBe("applied");
		expect(plan.steps[0].appliedVersion).toBe(4);
		expect(plan.expectedVersion).toBe(4);
		expect(h.state.flag.environments.production.version).toBe(4);
		expect(h.state.flag.environments.production.fallthrough.rollout.weights).toEqual([
			{ variationId: "v_off", weight: 90000 },
			{ variationId: "v_on", weight: 10000 },
		]);
		expect(h.state.flag.environments.production.lastChangedBy).toBe("marcus");
		expect(h.state.versions).toHaveLength(1);
		expect(h.state.versions[0]).toMatchObject({
			source: "rollout",
			actorId: "marcus",
			stepId: "s1",
			version: 4,
			reason: "Rollout step 10%",
		});
		expect(h.state.audit.map((entry) => entry.action)).toEqual(["rollout.stepApplied"]);
		expect(h.state.audit[0].idempotencyKey).toBe(appliedKey("plan1", "s1"));
		expect(h.state.audit.every((entry) => entry.actorKind === "system")).toBe(true);
		// Webhook emissions follow the audit write with deterministic ids (spec §9.2).
		expect(h.state.events.map((event) => event.event)).toEqual(["flag.config.updated", "rollout.stepApplied"]);
		expect(h.state.events.map((event) => event.eventId)).toEqual(["flag:flag1:production:v4:config", "rollout:plan1:s1:applied"]);
		expect(h.state.events[0]).toMatchObject({
			projectId: "proj1",
			environment: "production",
			data: { source: "rollout", version: 4, stepId: "s1" },
		});
		expect(plan.steps[1].status).toBe("pending");
	});
	test("two reconcilers racing on the same step write exactly one version", async () => {
		const h = harness();
		const second = createReconciler({ plans: h.plans, flags: h.flags, versions: h.versions, audit: h.audit });
		await Promise.all([h.reconciler.reconcileDue(NOW), second.reconcileDue(NOW)]);
		expect(h.state.versions).toHaveLength(1);
		expect(h.state.flag.environments.production.version).toBe(4);
		expect(h.plan().steps[0].status).toBe("applied");
	});
	test("version mismatch stalls the plan with CONFIG_CHANGED_OUTSIDE_ROLLOUT and releases the claim", async () => {
		const h = harness();
		h.state.flag.environments.production.version = 5;
		await h.reconciler.reconcileDue(NOW);
		const plan = h.plan();
		expect(plan.status).toBe("stalled");
		expect(plan.stallReason).toBe("CONFIG_CHANGED_OUTSIDE_ROLLOUT");
		expect(plan.steps[0].status).toBe("pending");
		expect(h.state.versions).toHaveLength(0);
		expect(h.state.audit.map((entry) => entry.action)).toEqual(["rollout.stalled"]);
		expect(h.state.audit[0].actorKind).toBe("system");
		expect(h.state.events.map((event) => event.event)).toEqual(["rollout.stalled"]);
		expect(h.state.events[0]).toMatchObject({
			eventId: "rollout:plan1:stalled:5",
			data: { stallReason: "CONFIG_CHANGED_OUTSIDE_ROLLOUT", expectedVersion: 3, currentVersion: 5 },
		});
	});
	test("same-version race releases the claim without stalling", async () => {
		const h = harness({ failWriteOnce: true });
		await h.reconciler.reconcileDue(NOW);
		expect(h.plan().status).toBe("scheduled");
		expect(h.plan().steps[0].status).toBe("pending");
		await h.reconciler.reconcileDue(NOW);
		expect(h.plan().steps[0].status).toBe("applied");
	});
	test("kill switch holds the step", async () => {
		const flag = flagTemplate();
		flag.killSwitch.active = true;
		const h = harness({ flag });
		await h.reconciler.reconcileDue(NOW);
		expect(h.plan().steps[0].status).toBe("pending");
		expect(h.state.versions).toHaveLength(0);
	});
	test("the last step completes the plan and audits completion once", async () => {
		const plan = planTemplate({ steps: [{ id: "s1", percent: 100, startAt: minutesAgo(1), status: "pending" }] });
		const h = harness({ plan });
		await h.reconciler.reconcileDue(NOW);
		expect(h.plan().status).toBe("completed");
		expect(h.state.audit.map((entry) => entry.action)).toEqual(["rollout.stepApplied", "rollout.completed"]);
		expect(h.state.audit.every((entry) => entry.actorKind === "system")).toBe(true);
		expect(h.state.events.map((event) => event.event)).toEqual(["flag.config.updated", "rollout.stepApplied", "rollout.completed"]);
		expect(h.state.events[2].eventId).toBe("rollout:plan1:completed");
		await h.reconciler.reconcileDue(NOW);
		expect(h.state.audit).toHaveLength(2);
	});
	test("several overdue steps apply in order within one pass", async () => {
		const plan = planTemplate({
			steps: [
				{ id: "s1", percent: 10, startAt: minutesAgo(10), status: "pending" },
				{ id: "s2", percent: 50, startAt: minutesAgo(5), status: "pending" },
			],
		});
		const h = harness({ plan });
		await h.reconciler.reconcileDue(NOW);
		expect(h.plan().steps.map((step) => step.appliedVersion)).toEqual([4, 5]);
		expect(h.plan().status).toBe("completed");
		expect(h.state.versions.map((entry) => entry.reason)).toEqual(["Rollout step 10%", "Rollout step 50%"]);
	});
});

describe("reconcileDue — crash recovery", () => {
	const staleStep = (extra = {}) => ({
		id: "s1",
		percent: 10,
		startAt: minutesAgo(5),
		status: "applying",
		claimedAt: minutesAgo(3),
		...extra,
	});
	const futureStep = { id: "s2", percent: 50, startAt: new Date(NOW.getTime() + 3600000), status: "pending" };

	test("version present but audit missing → audit inserted once, finalized, no second version", async () => {
		const h = harness({ plan: planTemplate({ status: "running", steps: [staleStep(), futureStep] }) });
		h.state.flag.environments.production.version = 4;
		h.state.versions.push({ rolloutPlanId: "plan1", stepId: "s1", version: 4, source: "rollout" });
		await h.reconciler.reconcileDue(NOW);
		expect(h.state.versions).toHaveLength(1);
		expect(h.state.audit.map((entry) => entry.action)).toEqual(["rollout.stepApplied"]);
		expect(h.plan().steps[0]).toMatchObject({ status: "applied", appliedVersion: 4 });
		expect(h.plan().expectedVersion).toBe(4);
		// Recovery re-emits the same ids; the delivery repository's unique index dedupes them (W3).
		expect(h.state.events.map((event) => event.eventId)).toEqual(["flag:flag1:production:v4:config", "rollout:plan1:s1:applied"]);
	});
	test("version and audit both present → nothing inserted, finalized", async () => {
		const h = harness({ plan: planTemplate({ status: "running", steps: [staleStep(), futureStep] }) });
		h.state.flag.environments.production.version = 4;
		h.state.versions.push({ rolloutPlanId: "plan1", stepId: "s1", version: 4, source: "rollout" });
		h.state.audit.push({ idempotencyKey: appliedKey("plan1", "s1"), action: "rollout.stepApplied" });
		await h.reconciler.reconcileDue(NOW);
		expect(h.state.versions).toHaveLength(1);
		expect(h.state.audit).toHaveLength(1);
		expect(h.plan().steps[0].status).toBe("applied");
	});
	test("nothing written → released and applied in the same pass", async () => {
		const h = harness({ plan: planTemplate({ status: "running", steps: [staleStep(), futureStep] }) });
		await h.reconciler.reconcileDue(NOW);
		expect(h.plan().steps[0]).toMatchObject({ status: "applied", appliedVersion: 4 });
		expect(h.state.versions).toHaveLength(1);
		expect(h.state.flag.environments.production.version).toBe(4);
	});
	test("flag advanced but no snapshot → snapshot inserted with source rollout and the creator as actor", async () => {
		const h = harness({ plan: planTemplate({ status: "running", steps: [staleStep(), futureStep] }) });
		const config = h.state.flag.environments.production;
		config.version = 4;
		config.fallthrough = {
			rollout: {
				bucketBy: "key",
				weights: [
					{ variationId: "v_on", weight: 10000 },
					{ variationId: "v_off", weight: 90000 },
				],
			},
		};
		await h.reconciler.reconcileDue(NOW);
		expect(h.state.versions).toHaveLength(1);
		expect(h.state.versions[0]).toMatchObject({ source: "rollout", actorId: "marcus", version: 4, stepId: "s1" });
		expect(h.plan().steps[0]).toMatchObject({ status: "applied", appliedVersion: 4 });
		expect(h.state.audit.map((entry) => entry.action)).toEqual(["rollout.stepApplied"]);
	});
	test("flag advanced to a different fallthrough → RECOVERY_AMBIGUOUS", async () => {
		const h = harness({ plan: planTemplate({ status: "running", steps: [staleStep(), futureStep] }) });
		const config = h.state.flag.environments.production;
		config.version = 4;
		config.fallthrough = { variationId: "v_on" };
		await h.reconciler.reconcileDue(NOW);
		expect(h.plan().status).toBe("stalled");
		expect(h.plan().stallReason).toBe("RECOVERY_AMBIGUOUS");
		expect(h.plan().steps[0].status).toBe("pending");
		expect(h.state.versions).toHaveLength(0);
	});
	test("a fresh claim is left alone", async () => {
		const h = harness({ plan: planTemplate({ status: "running", steps: [staleStep({ claimedAt: minutesAgo(0.5) }), futureStep] }) });
		await h.reconciler.reconcileDue(NOW);
		expect(h.plan().steps[0].status).toBe("applying");
		expect(h.state.versions).toHaveLength(0);
	});
});
