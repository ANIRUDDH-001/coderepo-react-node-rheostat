// Newline-delimited JSON to stdout: one line per event, flat fields, so `grep '"requestId":"…"'` works.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export const serializeError = (error) => {
	if (!(error instanceof Error)) return { name: "Error", message: String(error) };
	return {
		name: error.name,
		message: error.message,
		...(error.code ? { code: error.code } : {}),
		...(error.stack ? { stack: error.stack } : {}),
	};
};

export function createLogger({ level = "info", write = (line) => process.stdout.write(`${line}\n`) } = {}) {
	const threshold = LEVELS[level] ?? LEVELS.info;
	const emit =
		(lineLevel) =>
		(event, fields = {}) => {
			if (LEVELS[lineLevel] < threshold) return;
			const entry = { ts: new Date().toISOString(), level: lineLevel, event, ...fields };
			if (entry.error instanceof Error) entry.error = serializeError(entry.error);
			write(JSON.stringify(entry));
		};
	return { debug: emit("debug"), info: emit("info"), warn: emit("warn"), error: emit("error") };
}

export const logger = createLogger({ level: process.env.LOG_LEVEL || "info" });
