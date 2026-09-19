const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeTime(value, now = new Date()) {
	if (!value) return "";
	const delta = now.getTime() - new Date(value).getTime();
	const future = delta < 0;
	const distance = Math.abs(delta);
	const label = (amount, unit) => `${amount} ${unit}${amount === 1 ? "" : "s"}`;
	let text;
	if (distance < MINUTE) text = "just now";
	else if (distance < HOUR) text = label(Math.round(distance / MINUTE), "minute");
	else if (distance < DAY) text = label(Math.round(distance / HOUR), "hour");
	else if (distance < 30 * DAY) text = label(Math.round(distance / DAY), "day");
	else text = label(Math.round(distance / (30 * DAY)), "month");
	if (text === "just now") return text;
	return future ? `in ${text}` : `${text} ago`;
}

export const formatDate = (value) =>
	value ? new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";

export const formatDateTime = (value) =>
	value
		? new Date(value).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
		: "";

export const toDateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "");
