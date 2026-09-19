import { changeRequestService } from "../change-requests/change-request.service.js";
import { rolloutService } from "../rollouts/rollout.service.js";

// Late-bound collaborators, kept in one place so the dependency direction stays visible (spec §5.13):
// governance → change-requests, rollouts. Neither of those imports governance back.
export const governanceDeps = { changeRequests: changeRequestService, rollouts: rolloutService };
