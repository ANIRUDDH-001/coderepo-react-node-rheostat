import { z } from "zod";
import { OPERATORS } from "../../features/evaluation/evaluator.js";

export const clauseSchema = z
	.object({
		attribute: z.string().trim().min(1).max(60),
		operator: z.enum(OPERATORS),
		values: z.array(z.string().trim().min(1).max(200)).min(1).max(50),
		negate: z.boolean().default(false),
	})
	.strict();

export const serveSchema = z.union([
	z.object({ variationId: z.string().min(1).max(40) }).strict(),
	z
		.object({
			rollout: z
				.object({
					bucketBy: z.string().trim().min(1).max(60).default("key"),
					weights: z
						.array(z.object({ variationId: z.string().min(1).max(40), weight: z.number().int().min(0).max(100000) }).strict())
						.min(1)
						.max(8),
				})
				.strict(),
		})
		.strict(),
]);

export const ruleSchema = z
	.object({
		id: z.string().min(1).max(40).optional(),
		description: z.string().trim().max(200).default(""),
		clauses: z.array(clauseSchema).min(1).max(10),
		serve: serveSchema,
	})
	.strict();

export const envConfigSchema = z
	.object({
		enabled: z.boolean(),
		offVariationId: z.string().min(1).max(40),
		rules: z.array(ruleSchema).max(25),
		fallthrough: serveSchema,
	})
	.strict();
