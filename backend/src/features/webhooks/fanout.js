// Which subscriptions receive an event. Disabled subscriptions get nothing; environment filters apply only when
// the event carries an environment; `webhook.test` targets one subscription regardless of its event list.
export function fanout({ subscriptions, event, environment = null, eventId, payload, projectId, now, onlySubscriptionId = null }) {
	return subscriptions
		.filter((subscription) => subscription.enabled)
		.filter((subscription) => !onlySubscriptionId || String(subscription._id) === String(onlySubscriptionId))
		.filter((subscription) => event === "webhook.test" || subscription.events.includes(event))
		.filter((subscription) => !environment || subscription.environments.length === 0 || subscription.environments.includes(environment))
		.map((subscription) => ({
			subscriptionId: subscription._id,
			projectId,
			eventId,
			event,
			payload,
			status: "pending",
			attempts: [],
			budgetFrom: 0,
			nextAttemptAt: now,
			claimedAt: null,
			deliveredAt: null,
		}));
}
