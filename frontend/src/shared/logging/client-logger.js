// The browser console is the frontend's log sink; entries are structured so they can be pasted into a report.
const emit =
	(level) =>
	(event, fields = {}) =>
		console[level](`[rheostat] ${event}`, { ...fields, at: new Date().toISOString(), path: window.location.pathname });
export const clientLogger = { warn: emit("warn"), error: emit("error") };
