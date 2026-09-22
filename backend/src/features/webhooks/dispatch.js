import { SYSTEM_ACTOR } from "../../shared/auth/system-actor.js";
import { sign } from "./signature.js";

export const BACKOFF_MS = [0, 30000, 120000, 300000, 900000];
export const MAX_ATTEMPTS = BACKOFF_MS.length;
export const BREAKER_THRESHOLD = 5;

export const headersFor = (subscription, delivery, body, timestampSeconds) => ({
	"Content-Type": "application/json",
	"User-Agent": "Rheostat-Webhooks/1",
	"X-Rheostat-Event": delivery.event,
	"X-Rheostat-Delivery": String(delivery._id),
	"X-Rheostat-Subscription": String(subscription._id),
	"X-Rheostat-Signature": sign(subscription.secret, body, timestampSeconds),
});

const describeFailure = (error) => (error?.name === "TimeoutError" ? "timeout" : String(error?.message || error).slice(0, 300));

// The delivery worker (spec §9.5). Claim → send → record. Every branch is idempotent so the 5 s ticker,
// the post-enqueue kick, and dispatchOne can overlap. Only `pending` rows are ever claimed; `held` rows belong
// to disabled subscriptions and cost nothing here.
export function createDispatcher({
	deliveries,
	subscriptions,
	send,
	audit,
	log,
	clock = () => performance.now(),
	staleClaimMs = 60000,
	maxPerPass = 20,
}) {
	// Automated entries are attributed to the system actor; the creator is kept as metadata for context only.
	const auditFor = (subscription, delivery, action, summary, extra = {}) =>
		audit.record({
			actor: SYSTEM_ACTOR,
			actorKind: "system",
			action,
			entityType: "webhook",
			entityId: subscription._id,
			entityLabel: subscription.name || subscription.url,
			projectId: subscription.projectId,
			summary,
			metadata: {
				deliveryId: String(delivery._id),
				event: delivery.event,
				subscriptionCreatedBy: String(subscription.createdBy),
				...extra,
			},
		});

	async function attempt(delivery, now) {
		const subscription = await subscriptions.findById(delivery.subscriptionId);
		if (!subscription) {
			await deliveries.finish(delivery._id, { status: "dead", claimedAt: null });
			return "failed";
		}
		if (!subscription.enabled) {
			// Disabled between the exclusion read and the claim: park this row and the subscription's whole backlog at once.
			await deliveries.finish(delivery._id, { status: "held", claimedAt: null });
			await deliveries.holdPending(subscription._id);
			return "held";
		}
		const body = JSON.stringify(delivery.payload);
		const headers = headersFor(subscription, delivery, body, Math.floor(now.getTime() / 1000));
		const started = clock();
		let outcome;
		try {
			const response = await send(subscription.url, body, headers);
			outcome = {
				at: now,
				outcome: response.status >= 200 && response.status < 300 ? "delivered" : "failed",
				durationMs: Math.round(clock() - started),
				responseStatus: response.status,
				responseSnippet: (response.snippet || "").slice(0, 500),
			};
		} catch (error) {
			outcome = { at: now, outcome: "failed", durationMs: Math.round(clock() - started), error: describeFailure(error) };
		}
		const attempts = [...delivery.attempts, outcome];
		if (outcome.outcome === "delivered") {
			await deliveries.finish(delivery._id, { status: "delivered", attempts, deliveredAt: now, claimedAt: null });
			await subscriptions.recordOutcome(subscription._id, "delivered", now);
			return "delivered";
		}
		const budgetUsed = attempts.length - (delivery.budgetFrom || 0);
		if (budgetUsed < MAX_ATTEMPTS) {
			await deliveries.finish(delivery._id, {
				status: "pending",
				attempts,
				nextAttemptAt: new Date(now.getTime() + BACKOFF_MS[budgetUsed]),
				claimedAt: null,
			});
			return "failed";
		}
		await deliveries.finish(delivery._id, { status: "dead", attempts, claimedAt: null });
		const updated = await subscriptions.recordOutcome(subscription._id, "dead", now);
		await auditFor(
			subscription,
			delivery,
			"webhook.deliveryDead",
			`Delivery of ${delivery.event} to ${subscription.name || subscription.url} failed ${MAX_ATTEMPTS} times and was dead-lettered.`,
			{
				attempts: attempts.length,
				lastError: outcome.error || `HTTP ${outcome.responseStatus}`,
			},
		);
		if (updated.consecutiveFailures >= BREAKER_THRESHOLD && (await subscriptions.disableAuto(subscription._id))) {
			await deliveries.holdPending(subscription._id);
			await auditFor(
				subscription,
				delivery,
				"webhook.autoDisabled",
				`${subscription.name || subscription.url} was disabled after ${BREAKER_THRESHOLD} consecutive dead-lettered deliveries.`,
			);
			log.warn("webhook.autoDisabled", { subscriptionId: String(subscription._id) });
		}
		return "failed";
	}

	return {
		async dispatchDue(now = new Date()) {
			await deliveries.releaseStale(new Date(now.getTime() - staleClaimMs));
			const excluded = await subscriptions.findDisabledIds();
			const result = { sent: 0, delivered: 0, failed: 0 };
			for (let index = 0; index < maxPerPass; index += 1) {
				const delivery = await deliveries.claimNext(now, excluded);
				if (!delivery) break;
				const outcome = await attempt(delivery, now);
				if (outcome === "held") continue;
				result.sent += 1;
				if (outcome === "delivered") result.delivered += 1;
				else result.failed += 1;
			}
			return result;
		},
		async dispatchOne(id, now = new Date()) {
			const delivery = await deliveries.claimById(id, now);
			if (!delivery) return "missing";
			return attempt(delivery, now);
		},
	};
}
