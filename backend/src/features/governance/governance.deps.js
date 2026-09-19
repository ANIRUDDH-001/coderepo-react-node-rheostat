import { changeRequestService } from "../change-requests/change-request.service.js";

// Late-bound collaborators. `rollouts: null` means the capability does not exist yet (Phase 5 replaces it);
// governance → change-requests is the only direction (spec §5.13): change requests never import governance.
export const governanceDeps = { changeRequests: changeRequestService, rollouts: null };
