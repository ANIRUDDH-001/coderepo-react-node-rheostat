export const percent = (weight) => `${(weight / 1000).toFixed(weight % 1000 ? 1 : 0)}%`;

export const slugify = (text) =>
	String(text)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/^[^a-z]+/, "")
		.slice(0, 40);

export const formatValue = (value) => {
	if (value === null || value === undefined) return "—";
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
};

export const pluralize = (count, noun, plural = `${noun}s`) => `${count} ${count === 1 ? noun : plural}`;

// Turns an ApiError into field-level messages ({ field: message }) plus a general message.
export function fieldErrors(error) {
	const details = error?.details || {};
	const fields = {};
	for (const [field, messages] of Object.entries(details.fieldErrors || {})) fields[field] = messages[0];
	const general = [...(details.formErrors || []), ...(details.issues || [])];
	return { fields, general, message: error?.message || "" };
}
