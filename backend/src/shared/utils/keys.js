import { randomUUID } from "node:crypto";
import { z } from "zod";

export const KEY_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;
export const keySchema = z.string().regex(KEY_PATTERN, "Use lowercase letters, numbers, and hyphens, starting with a letter.");
export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Provide a valid identifier.");
export const shortId = (prefix) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
export const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
