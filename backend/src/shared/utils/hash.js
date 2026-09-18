import { createHash } from "node:crypto";

// Rollout weights are expressed in hundred-thousandths so 12.345% is representable exactly.
export const BUCKET_SPACE = 100000;

// A context lands in the same bucket for a given flag and environment on every evaluation.
export function bucketFor(flagKey, environmentKey, value) {
	const digest = createHash("sha1")
		.update(`${flagKey}.${environmentKey}.${String(value)}`)
		.digest("hex");
	return Number.parseInt(digest.slice(0, 8), 16) % BUCKET_SPACE;
}
