import { rolloutService } from "../rollouts/rollout.service.js";

// change-requests → rollouts (active-rollout guard only); rollouts never import change requests.
export const changeRequestDeps = { rollouts: rolloutService };
