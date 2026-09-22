import { assertCan } from "../../shared/auth/permissions.js";
import { changeRequestService } from "../change-requests/change-request.service.js";
import { evaluationService } from "../evaluation/evaluation.service.js";
import { decorateFlag, flagService } from "../flags/flag.service.js";
import { rolloutService } from "../rollouts/rollout.service.js";
import { webhookService } from "../webhooks/webhook.service.js";
import { dailySeries, topFlagDistributions } from "./series.js";

// Dependency direction (spec §5.13): dashboard → flags, change-requests, rollouts, evaluation, projects. Read paths only.
const DAY_MS = 24 * 60 * 60 * 1000;
export const ACTIVITY_DAYS = 14;

const startOfUtcDay = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

export const dashboardService = {
	async get(project, profile, now = new Date()) {
		assertCan(profile, "dashboard:read");
		const to = new Date(startOfUtcDay(now).getTime() + DAY_MS);
		const from = new Date(to.getTime() - ACTIVITY_DAYS * DAY_MS);
		const [flags, rollouts, changeRequests, recentVersions, activity, webhooks] = await Promise.all([
			flagService.findAllByProject(project._id).then((rows) => rows.map((flag) => decorateFlag(flag, now))),
			rolloutService.list(project, { status: "active", page: 1, pageSize: 10 }, profile),
			changeRequestService.list(project, { needsMyReview: true, page: 1, pageSize: 5 }, profile),
			flagService.recentVersions(project._id, "production", 10),
			evaluationService.activity(project._id, from, to),
			webhookService.stats(project._id),
		]);
		const live = flags.filter((flag) => !flag.archived);
		const byId = new Map(flags.map((flag) => [String(flag._id), flag]));
		return {
			flagCounts: {
				total: flags.length,
				active: live.length,
				archived: flags.length - live.length,
				temporary: live.filter((flag) => flag.lifecycle?.kind === "temporary").length,
				readyToRemove: live.filter((flag) => flag.stale.readyToRemove).length,
				overdue: live.filter((flag) => flag.stale.overdue).length,
				killSwitched: live.filter((flag) => flag.killSwitch?.active).length,
			},
			activeRollouts: rollouts.items.map((plan) => ({
				id: String(plan._id),
				flagKey: plan.flagKey,
				environment: plan.environment,
				status: plan.status,
				currentPercent: plan.currentPercent,
				nextStep: plan.nextStep ? { percent: plan.nextStep.percent, startAt: plan.nextStep.startAt } : null,
			})),
			pendingChangeRequests: { ...changeRequests.counts, items: changeRequests.items },
			// Stats only (hardening spec §9.6): the dashboard reads webhooks, never the other way round.
			webhooks,
			recentProductionChanges: recentVersions.map((version) => ({
				...version,
				flagKey: byId.get(String(version.flagId))?.key || "",
				flagName: byId.get(String(version.flagId))?.name || "",
			})),
			staleFlags: live
				.filter((flag) => flag.stale.readyToRemove || flag.stale.overdue)
				.map((flag) => ({
					flagKey: flag.key,
					name: flag.name,
					readyToRemove: flag.stale.readyToRemove,
					overdue: flag.stale.overdue,
					removeBy: flag.lifecycle?.removeBy || null,
					lastEffectiveChangeAt: flag.stale.lastEffectiveChangeAt,
				})),
			killSwitches: live
				.filter((flag) => flag.killSwitch?.active)
				.map((flag) => ({ flagKey: flag.key, name: flag.name, ...flag.killSwitch })),
			evaluations: {
				days: dailySeries(activity.byDay, from, to),
				byFlag: topFlagDistributions(activity.byFlagVariation, live, 8),
			},
		};
	},
};
