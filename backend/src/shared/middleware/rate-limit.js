import { AppError } from "../errors/app-error.js";

const SWEEP_ABOVE = 1000;

// Fixed-window counter per key, in memory: Rheostat is one process. The store is the only part a
// shared deployment would replace (Redis INCR + EXPIRE has the same shape).
export function createRateLimiter({ name, windowMs, max, keyFor, now = () => Date.now() }) {
	const store = new Map();
	const sweep = (current) => {
		if (store.size < SWEEP_ABOVE) return;
		for (const [key, entry] of store) if (entry.resetAt <= current) store.delete(key);
	};
	const middleware = (request, response, next) => {
		const current = now();
		sweep(current);
		const key = `${name}:${keyFor(request)}`;
		let entry = store.get(key);
		if (!entry || entry.resetAt <= current) {
			entry = { count: 0, resetAt: current + windowMs };
			store.set(key, entry);
		}
		entry.count += 1;
		const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - current) / 1000));
		response.setHeader("RateLimit-Limit", max);
		response.setHeader("RateLimit-Remaining", Math.max(0, max - entry.count));
		response.setHeader("RateLimit-Reset", retryAfterSeconds);
		if (entry.count > max) {
			response.setHeader("Retry-After", retryAfterSeconds);
			return next(
				new AppError(429, "RATE_LIMITED", `Too many requests. Try again in ${retryAfterSeconds} seconds.`, {
					retryAfterSeconds,
					limit: max,
				}),
			);
		}
		return next();
	};
	middleware.reset = () => store.clear();
	return middleware;
}
