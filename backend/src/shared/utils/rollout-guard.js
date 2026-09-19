import { AppError } from "../errors/app-error.js";

// Spec §5.12: writes into an environment with an active rollout need an explicit acknowledgement.
export function assertNoActiveRollout(activePlan, acknowledged) {
	if (!activePlan || acknowledged === true) return;
	throw new AppError(
		409,
		"ROLLOUT_ACTIVE",
		"A rollout is active in this environment. Acknowledge it to save anyway; the rollout will stall.",
		{
			planId: String(activePlan._id),
			currentPercent: activePlan.currentPercent ?? 0,
			status: activePlan.status,
		},
	);
}
