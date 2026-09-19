import { z } from "zod";

export const FLAG_TYPES = ["boolean", "string", "number", "json"];

export function variationValueSchema(type) {
	if (type === "boolean") return z.boolean();
	if (type === "number") return z.number().finite();
	if (type === "json") return z.record(z.string(), z.unknown());
	return z.string().min(1).max(500);
}

// A new flag starts off everywhere: the second variation is served while disabled, the first when enabled.
export function initialConfig(flag) {
	return {
		version: 1,
		enabled: false,
		offVariationId: flag.variations[1].id,
		rules: [],
		fallthrough: { variationId: flag.variations[0].id },
	};
}
