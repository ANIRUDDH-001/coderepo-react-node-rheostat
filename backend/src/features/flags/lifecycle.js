// Stale-flag lifecycle rules. Only configuration versions move lastEffectiveChangeAt; metadata edits never do.
export const STALE_AFTER_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

const servesSingleVariation = (config) =>
	!config.enabled || ((config.rules || []).length === 0 && Boolean(config.fallthrough?.variationId));

export function isFullyRolledOut(flag) {
	return Object.values(flag.environments || {}).every(servesSingleVariation);
}

export function staleState(flag, now = new Date()) {
	const timestamps = Object.values(flag.environments || {})
		.map((config) => (config.lastEffectiveChangeAt ? new Date(config.lastEffectiveChangeAt).getTime() : 0))
		.filter(Boolean);
	const lastEffectiveChangeAt = timestamps.length ? new Date(Math.max(...timestamps)) : null;
	const temporary = flag.lifecycle?.kind === "temporary";
	const fullyRolledOut = isFullyRolledOut(flag);
	const untouched = lastEffectiveChangeAt ? now.getTime() - lastEffectiveChangeAt.getTime() >= STALE_AFTER_DAYS * DAY_MS : false;
	const removeBy = flag.lifecycle?.removeBy ? new Date(flag.lifecycle.removeBy) : null;
	return {
		fullyRolledOut,
		readyToRemove: temporary && fullyRolledOut && untouched,
		overdue: temporary && Boolean(removeBy) && removeBy.getTime() < now.getTime(),
		lastEffectiveChangeAt,
	};
}
