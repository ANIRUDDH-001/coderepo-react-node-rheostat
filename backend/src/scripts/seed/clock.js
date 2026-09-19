// Seed dates are relative to "today" so the demo always looks current. DEMO_TODAY=YYYY-MM-DD pins it.
const DAY_MS = 24 * 60 * 60 * 1000;

const parseToday = () => {
	const override = process.env.DEMO_TODAY;
	if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) return new Date(`${override}T12:00:00.000Z`);
	const now = new Date();
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
};

export const DEMO_TODAY = parseToday();

// `daysAgo(3, 9, 30)` → 09:30 UTC three days before today.
export const daysAgo = (days, hour = 10, minute = 0) =>
	new Date(DEMO_TODAY.getTime() - days * DAY_MS + (hour - 12) * 60 * 60 * 1000 + minute * 60 * 1000);
export const daysFromNow = (days, hour = 10) => daysAgo(-days, hour);
export const isoDate = (date) => date.toISOString().slice(0, 10);
