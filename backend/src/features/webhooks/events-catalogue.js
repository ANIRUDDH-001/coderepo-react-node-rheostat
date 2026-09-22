export const EVENT_GROUPS = {
	flag: ["flag.config.updated", "flag.killSwitch.activated", "flag.killSwitch.cleared", "flag.archived", "flag.restored"],
	changeRequest: ["changeRequest.applied"],
	rollout: ["rollout.stepApplied", "rollout.stalled", "rollout.completed", "rollout.aborted"],
	webhook: ["webhook.test"],
};
export const WEBHOOK_EVENTS = Object.values(EVENT_GROUPS).flat();
