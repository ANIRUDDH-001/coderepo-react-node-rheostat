// Late-bound collaborators that arrive in later phases. `null` means the capability does not exist yet:
// no rollout can be active, and a protected environment cannot be written through a change request.
// Phase 4 and Phase 5 replace these with the real services; nothing else in governance changes.
export const governanceDeps = { changeRequests: null, rollouts: null };
