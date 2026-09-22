# Rheostat Hardening Implementation Plan (revision 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add outbound webhooks (Mongo-backed queue, retries, dead-letter, held deliveries, signed payloads, built-in receiver) and eight cross-cutting improvements — structured logging with end-to-end request ids, rate limiting, error boundaries, code splitting, a generation-safe client cache with request deduplication, optimistic updates with a defined cache policy, DOM-free component tests, and README engineering notes — without adding dependencies.

**Architecture:** Backend infrastructure lives in `backend/src/shared/{logging,middleware}`. Webhooks are a leaf feature folder (`backend/src/features/webhooks`) reached by other services only through `webhookEvents.emit/enqueue`. The worker is a pure `createDispatcher(deps)` tested with fakes; the service is `createWebhookService(deps)` and the routers `createWebhookRouters(service)` / `createSinkRouter(deps)`, so HTTP tests run real Express requests against fake repositories, and an opt-in Mongo integration suite proves the database-level guarantees. Frontend changes are confined to `shared/api`, `shared/components`, `shared/hooks`, the shell, and `features/webhooks`.

**Tech Stack:** Bun 1.4 workspace; Express 5.2.1, Mongoose 8.24.1, Zod 4.3.6, `node:crypto`; React 19.2.4 (`react-dom/server` for render tests), Vite 8.2.2; `bun test` at the repo root. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-21-rheostat-hardening-design.md` (revision 3). Original plan: `docs/superpowers/plans/2026-09-18-rheostat.md`.

## Global Constraints

- Dependency freeze: no new runtime or dev dependency, no manifest or lockfile change (GUIDELINES §2.2).
- Sandbox limits: no WebSockets, no external hosted services (GUIDELINES §2.4). The demo receiver is the in-product sink over loopback.
- Envelopes stay `{ data }` / `{ error: { code, message, details, requestId } }`; `AppError(statusCode, code, message, details)`; Zod errors → 400 `VALIDATION_ERROR`.
- Service graph (hardening spec §9.9): `webhooks → projects, audit`; `flags`, `change-requests`, `rollouts` import only `webhooks/events.js`.
- Prettier `bunx prettier@3.6.2 --write/--check "backend/src/**/*.js" "frontend/src/**/*.{js,jsx}"`; tabs.
- American English copy; every control labelled; every list page has skeleton, empty, and error states.
- Ports 3000/8000; Mongo `mongodb://localhost:27017/rheostat_db`; `bun start` seeds and runs both servers.
- `bun test` must pass with no database. Files named `*.integration.test.js` skip themselves unless `MONGODB_TEST_URI` is set; phase gates run them with `MONGODB_TEST_URI=mongodb://localhost:27017/rheostat_test bun test`.
- Tests that import `createApp()` set `process.env.MONGODB_URI = "mongodb://localhost:27017/rheostat_test"` and `process.env.JWT_SECRET = "test-secret"` before importing, and call `initConfig()`; no connection is opened.
- The user handles git commits; each task ends with a verification step.
- Log entries per AGENTS.md after each phase gate.

## Where this plan slots into the original

Phase 5 finishes first as written. Then: **Phase 6** = original Tasks 6.1–6.4 + Tasks 6.5–6.10 below (logging and rate limiting are here because the sink and worker use them); **Phase 6.5** = W1–W8 (W5 and W7 are split into A–E); **Phase 7** = original 7.1–7.4 + 7.5–7.6 below.

---

## Phase 6 additions

### Task 6.5: Structured logging and request correlation

**Files:**
- Create: `backend/src/shared/logging/logger.js`, `backend/src/shared/logging/logger.test.js`, `backend/src/shared/middleware/request-context.js`, `backend/src/shared/middleware/request-context.test.js`, `backend/src/shared/middleware/app-envelope.test.js`
- Modify: `backend/src/app.js`, `backend/src/shared/middleware/error-handler.js`, `backend/src/index.js`, `backend/src/shared/config/database.js`, `backend/src/shared/config/index.js`, `backend/.env.example`, `frontend/src/shared/api/client.js`, `frontend/src/shared/components/ErrorBanner.jsx`, `frontend/src/styles.css`

**Interfaces:**
- Produces: `createLogger({ level, write })`, `logger.{debug,info,warn,error}(event, fields)`, `serializeError(error)`; `createRequestContext({ log, now })`, `requestContext`; every error envelope carries `requestId`; `ApiError.requestId`; `request()` sends `X-Request-Id`; `ErrorBanner` prop `requestId`.

- [ ] **Step 1: Logger test**

`backend/src/shared/logging/logger.test.js`:

```js
import { describe, expect, test } from "bun:test";
import { createLogger, serializeError } from "./logger.js";

const capture = () => {
	const lines = [];
	return { lines, write: (line) => lines.push(JSON.parse(line)) };
};

describe("logger", () => {
	test("writes one JSON line with ts, level, event and fields", () => {
		const out = capture();
		createLogger({ level: "info", write: out.write }).info("http.request", { method: "GET", status: 200 });
		expect(out.lines).toHaveLength(1);
		expect(out.lines[0]).toMatchObject({ level: "info", event: "http.request", method: "GET", status: 200 });
		expect(typeof out.lines[0].ts).toBe("string");
	});
	test("drops lines below the configured level", () => {
		const out = capture();
		const log = createLogger({ level: "warn", write: out.write });
		log.info("ignored", {});
		log.warn("kept", {});
		expect(out.lines.map((line) => line.event)).toEqual(["kept"]);
	});
	test("serializes Error fields", () => {
		const out = capture();
		createLogger({ write: out.write }).error("x", { error: Object.assign(new Error("boom"), { code: "X" }) });
		expect(out.lines[0].error).toMatchObject({ name: "Error", message: "boom", code: "X" });
		expect(out.lines[0].error.stack).toContain("boom");
		expect(serializeError("plain")).toEqual({ name: "Error", message: "plain" });
	});
});
```

- [ ] **Step 2: Run** `bun test backend/src/shared/logging/logger.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement**

`backend/src/shared/logging/logger.js`:

```js
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
	const emit = (lineLevel) => (event, fields = {}) => {
		if (LEVELS[lineLevel] < threshold) return;
		const entry = { ts: new Date().toISOString(), level: lineLevel, event, ...fields };
		if (entry.error instanceof Error) entry.error = serializeError(entry.error);
		write(JSON.stringify(entry));
	};
	return { debug: emit("debug"), info: emit("info"), warn: emit("warn"), error: emit("error") };
}

export const logger = createLogger({ level: process.env.LOG_LEVEL || "info" });
```

- [ ] **Step 4: Run** → 3 pass.

- [ ] **Step 5: Request-context test**

`backend/src/shared/middleware/request-context.test.js`:

```js
import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { createRequestContext } from "./request-context.js";

const fakeResponse = () => {
	const response = new EventEmitter();
	response.headers = {};
	response.statusCode = 200;
	response.setHeader = (name, value) => {
		response.headers[name.toLowerCase()] = value;
	};
	return response;
};
const fakeRequest = (headers = {}) => ({ method: "GET", originalUrl: "/api/v1/projects?x=1", get: (name) => headers[name.toLowerCase()] });

describe("requestContext", () => {
	test("assigns a uuid when no header is present, echoes it, and logs on finish", () => {
		const lines = [];
		const middleware = createRequestContext({ log: { info: (event, fields) => lines.push({ event, ...fields }) } });
		const request = fakeRequest();
		const response = fakeResponse();
		middleware(request, response, () => {});
		expect(request.id).toMatch(/^[0-9a-f-]{36}$/);
		expect(response.headers["x-request-id"]).toBe(request.id);
		response.emit("finish");
		expect(lines[0]).toMatchObject({ event: "http.request", requestId: request.id, method: "GET", path: "/api/v1/projects", status: 200 });
		expect(typeof lines[0].durationMs).toBe("number");
	});
	test("accepts a well-formed client id and replaces a malformed one", () => {
		const middleware = createRequestContext({ log: { info: () => {} } });
		const good = fakeRequest({ "x-request-id": "client-abc12345" });
		middleware(good, fakeResponse(), () => {});
		expect(good.id).toBe("client-abc12345");
		const bad = fakeRequest({ "x-request-id": "no spaces allowed!" });
		middleware(bad, fakeResponse(), () => {});
		expect(bad.id).toMatch(/^[0-9a-f-]{36}$/);
	});
	test("includes account and profile ids set later by the auth middlewares", () => {
		const lines = [];
		const middleware = createRequestContext({ log: { info: (event, fields) => lines.push(fields) } });
		const request = fakeRequest();
		const response = fakeResponse();
		middleware(request, response, () => {});
		request.account = { _id: "acc1" };
		request.profileId = "prof1";
		response.emit("finish");
		expect(lines[0]).toMatchObject({ accountId: "acc1", profileId: "prof1" });
	});
});
```

- [ ] **Step 6: Run** → FAIL (module not found).

- [ ] **Step 7: Implement**

`backend/src/shared/middleware/request-context.js`:

```js
import { randomUUID } from "node:crypto";
import { logger } from "../logging/logger.js";

const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/;

// First middleware after CORS, ahead of every body parser, so a request that fails to parse still has an id.
export function createRequestContext({ log = logger, now = () => performance.now() } = {}) {
	return function requestContext(request, response, next) {
		const supplied = request.get("x-request-id") || "";
		request.id = CLIENT_ID.test(supplied) ? supplied : randomUUID();
		response.setHeader("X-Request-Id", request.id);
		const started = now();
		response.on("finish", () => {
			log.info("http.request", {
				requestId: request.id,
				method: request.method,
				path: request.originalUrl.split("?")[0],
				status: response.statusCode,
				durationMs: Math.round(now() - started),
				...(request.account ? { accountId: String(request.account._id) } : {}),
				...(request.profileId ? { profileId: request.profileId } : {}),
			});
		});
		next();
	};
}

export const requestContext = createRequestContext();
```

- [ ] **Step 8: Run** → 3 pass.

- [ ] **Step 9: Middleware order and error envelopes**

`backend/src/app.js` — the top of `createApp` becomes exactly:

```js
	const app = express();
	app.disable("x-powered-by");
	app.use(cors({ exposedHeaders: ["X-Request-Id", "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset", "Retry-After"] }));
	app.use("/api", requestContext);
	// The webhook sink verifies an HMAC over the exact bytes, so it reads the raw body ahead of the JSON parser (Task W5C mounts it here).
	app.use(express.json({ limit: "200kb" }));
	app.use(express.static(publicDirectory));
```

`backend/src/shared/middleware/error-handler.js` becomes:

```js
import { ZodError } from "zod";
import { AppError } from "../errors/app-error.js";
import { logger } from "../logging/logger.js";

const envelope = (request, code, message, details) => ({
	error: { code, message, ...(details !== undefined ? { details } : {}), requestId: request.id || null },
});

export function notFoundHandler(request, response) {
	response.status(404).json(envelope(request, "NOT_FOUND", `Route ${request.method} ${request.path} was not found.`));
}

export function errorHandler(error, request, response, next) {
	if (error instanceof ZodError) {
		return response.status(400).json(envelope(request, "VALIDATION_ERROR", "Request validation failed.", error.flatten()));
	}
	if (error instanceof AppError) {
		if (error.statusCode >= 500) logger.error("http.error", { requestId: request.id, code: error.code, error });
		return response.status(error.statusCode).json(envelope(request, error.code, error.message, error.details));
	}
	if (error?.type === "entity.parse.failed") {
		return response.status(400).json(envelope(request, "INVALID_JSON", "The request body is not valid JSON."));
	}
	if (error?.type === "entity.too.large") {
		return response.status(413).json(envelope(request, "PAYLOAD_TOO_LARGE", "The request body is too large."));
	}
	if (error?.code === 11000) {
		const field = Object.keys(error.keyPattern || {}).join(", ") || "value";
		return response.status(409).json(envelope(request, "DUPLICATE_KEY", `A record with the same ${field} already exists.`));
	}
	logger.error("http.error", { requestId: request.id, error });
	return response.status(500).json(envelope(request, "INTERNAL_ERROR", "An unexpected error occurred."));
}
```

(`next` stays: Express identifies error handlers by arity.)

- [ ] **Step 10: Envelope integration test over real HTTP**

`backend/src/shared/middleware/app-envelope.test.js`:

```js
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

process.env.MONGODB_URI = "mongodb://localhost:27017/rheostat_test";
process.env.JWT_SECRET = "test-secret";
const { initConfig } = await import("../config/index.js");
initConfig();
const { createApp } = await import("../../app.js");

let server;
let base;
beforeAll(async () => {
	server = createApp().listen(0, "127.0.0.1");
	await new Promise((resolve) => server.once("listening", resolve));
	base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server.close());

describe("error envelopes carry a request id", () => {
	test("malformed JSON → 400 INVALID_JSON with the echoed request id", async () => {
		const response = await fetch(`${base}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-request-id": "trace-00001234" }, body: "{not json" });
		expect(response.status).toBe(400);
		expect(response.headers.get("x-request-id")).toBe("trace-00001234");
		const body = await response.json();
		expect(body.error).toMatchObject({ code: "INVALID_JSON", requestId: "trace-00001234" });
	});
	test("oversized JSON → 413 PAYLOAD_TOO_LARGE with a generated request id", async () => {
		const response = await fetch(`${base}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pad: "x".repeat(210 * 1024) }) });
		expect(response.status).toBe(413);
		const body = await response.json();
		expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
		expect(body.error.requestId).toMatch(/^[0-9a-f-]{36}$/);
		expect(response.headers.get("x-request-id")).toBe(body.error.requestId);
	});
	test("unknown route → 404 with request id", async () => {
		const response = await fetch(`${base}/api/v1/nope`);
		expect(response.status).toBe(404);
		expect((await response.json()).error.requestId).toBeTruthy();
	});
});
```

- [ ] **Step 11: Run** `bun test backend/src/shared/middleware/app-envelope.test.js` → 3 pass. (This test imports the whole app; if any module opens a Mongo connection at import time the test hangs — none do today, and none may be added.)

- [ ] **Step 12: Replace console calls; config**

`backend/src/index.js`: import `logger`; `listen` callback → `logger.info("server.started", { port: config.port, env: config.nodeEnv })`; rollout ticker catch → `logger.error("rollout.tick.failed", { error })`; shutdown → `logger.info("server.stopping", { signal })`. `backend/src/shared/config/database.js`: `logger.info("database.connected")` / `logger.error("database.connect.failed", { error })`. `backend/src/shared/config/index.js`: add `logLevel: getOptionalEnv("LOG_LEVEL", "info")` and `apiOrigin: getOptionalEnv("API_ORIGIN", \`http://localhost:${port}\`)` (compute `port` first). `backend/.env.example`: add `LOG_LEVEL=info` and `API_ORIGIN=http://localhost:8000`.

- [ ] **Step 13: Frontend request ids**

`frontend/src/shared/api/client.js` — replace `ApiError` and `request`:

```js
export class ApiError extends Error {
	constructor(status, code, message, details, { requestId = "", retryAfterSeconds = 0 } = {}) {
		super(message);
		this.status = status;
		this.code = code;
		this.details = details;
		this.requestId = requestId;
		this.retryAfterSeconds = retryAfterSeconds;
	}
}

const newRequestId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

export async function request(path, options = {}) {
	const requestId = newRequestId();
	const response = await fetch(`${baseUrl}${path}`, {
		...options,
		headers: {
			"Content-Type": "application/json",
			"X-Request-Id": requestId,
			...(profileToken || sessionToken ? { Authorization: `Bearer ${profileToken || sessionToken}` } : {}),
			...options.headers,
		},
	});
	if (response.status === 204) return null;
	const contentType = response.headers?.get?.("content-type") || "";
	const payload = contentType.includes("application/json") || !response.headers ? await response.json() : null;
	if (!response.ok) {
		const code = payload?.error?.code;
		const message = payload?.error?.message || `Rheostat service returned ${response.status}.`;
		if (response.status === 401 && ["AUTH_REQUIRED", "INVALID_TOKEN", "ACCOUNT_UNAVAILABLE"].includes(code)) {
			setProfileToken("");
			setSessionToken("");
			localStorage.removeItem(PROFILE_ID_KEY);
			window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: message }));
		}
		throw new ApiError(response.status, code, message, payload?.error?.details, {
			requestId: response.headers?.get?.("x-request-id") || payload?.error?.requestId || requestId,
			retryAfterSeconds: Number(response.headers?.get?.("retry-after")) || payload?.error?.details?.retryAfterSeconds || 0,
		});
	}
	if (!payload || !("data" in payload))
		throw new ApiError(response.status, "INVALID_RESPONSE", "Rheostat service returned an invalid response.", undefined, { requestId });
	return payload.data;
}
```

`ErrorBanner.jsx`: add prop `requestId = ""`; render `{requestId && <span className="error-reference">Reference: {requestId}</span>}` inside the banner body. Every `useAsync` consumer that renders `<ErrorBanner message={error.message} …>` passes `requestId={error.status >= 500 ? error.requestId : ""}` (`Workspace.jsx`, `FlagsPage.jsx`, `FlagDetailPage.jsx`, `ChangeRequestsPage.jsx`, `ChangeRequestDetailPage.jsx`, `SegmentsPage.jsx`, `SegmentEditorPage.jsx`, `PlaygroundPage.jsx`, `RolloutsPage.jsx`, `RolloutDetailPage.jsx`). `styles.css`: `.error-reference { display: block; margin-top: 4px; color: var(--muted); font-family: monospace; font-size: 12px; }`.

- [ ] **Step 14: Verify**

`bun test` → all pass. `grep -rn "console\." backend/src --include=*.js | grep -v scripts/` → empty. Start the app: `curl -i localhost:8000/api/v1/health` shows `X-Request-Id`; the log shows an `http.request` JSON line. Browser Network tab: every `/api` request carries `X-Request-Id` and the response echoes the same value. Temporarily throw in `listFlags` → banner shows "Reference: <id>" equal to the response header; revert.

### Task 6.6: Rate limiting

**Files:**
- Create: `backend/src/shared/middleware/rate-limit.js`, `backend/src/shared/middleware/rate-limit.test.js`
- Modify: `backend/src/features/auth/auth.routes.js`, `backend/src/features/evaluation/evaluation.routes.js`, `frontend/src/features/auth/WorkspaceLogin.jsx`, `frontend/src/features/playground/PlaygroundPage.jsx`, `frontend/src/shared/hooks/useCountdown.js` (create)

**Interfaces:**
- Produces: `createRateLimiter({ name, windowMs, max, keyFor, now? }) → middleware` with `middleware.reset()`; `useCountdown() → { secondsLeft, start(seconds) }`.

- [ ] **Step 1: Test**

`backend/src/shared/middleware/rate-limit.test.js`:

```js
import { describe, expect, test } from "bun:test";
import { createRateLimiter } from "./rate-limit.js";

const run = (middleware, key = "a") => {
	const request = { ip: "1.1.1.1", body: {}, rateKey: key };
	const response = { headers: {}, setHeader(name, value) { this.headers[name] = value; } };
	let error = null;
	middleware(request, response, (caught) => { error = caught || null; });
	return { response, error };
};

describe("createRateLimiter", () => {
	test("allows max requests per window, then 429 with headers, then resets", () => {
		let clock = 1000;
		const limiter = createRateLimiter({ name: "t", windowMs: 60000, max: 2, keyFor: (request) => request.rateKey, now: () => clock });
		expect(run(limiter).error).toBeNull();
		const second = run(limiter);
		expect(second.error).toBeNull();
		expect(second.response.headers["RateLimit-Remaining"]).toBe(0);
		const third = run(limiter);
		expect(third.error.statusCode).toBe(429);
		expect(third.error.code).toBe("RATE_LIMITED");
		expect(third.error.details).toEqual({ retryAfterSeconds: 60, limit: 2 });
		expect(third.response.headers["Retry-After"]).toBe(60);
		clock += 60001;
		expect(run(limiter).error).toBeNull();
	});
	test("keys are independent", () => {
		const limiter = createRateLimiter({ name: "t", windowMs: 60000, max: 1, keyFor: (request) => request.rateKey });
		expect(run(limiter, "a").error).toBeNull();
		expect(run(limiter, "b").error).toBeNull();
		expect(run(limiter, "a").error.statusCode).toBe(429);
	});
	test("reset clears the store", () => {
		const limiter = createRateLimiter({ name: "t", windowMs: 60000, max: 1, keyFor: (request) => request.rateKey });
		run(limiter);
		limiter.reset();
		expect(run(limiter).error).toBeNull();
	});
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```js
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
			return next(new AppError(429, "RATE_LIMITED", `Too many requests. Try again in ${retryAfterSeconds} seconds.`, { retryAfterSeconds, limit: max }));
		}
		return next();
	};
	middleware.reset = () => store.clear();
	return middleware;
}
```

- [ ] **Step 4: Run** → 3 pass.

- [ ] **Step 5: Apply**

`auth.routes.js`: `export const loginLimiter = createRateLimiter({ name: "login", windowMs: 15 * 60 * 1000, max: 10, keyFor: (request) => \`${request.ip}:${String(request.body?.email || "").trim().toLowerCase()}\` });` and `authRouter.post("/login", loginLimiter, login);`. `evaluation.routes.js`: `export const evaluateLimiter = createRateLimiter({ name: "evaluate", windowMs: 60 * 1000, max: 60, keyFor: (request) => request.profileId });` applied to the evaluate POST handler already registered there.

- [ ] **Step 6: Countdown UI**

`frontend/src/shared/hooks/useCountdown.js`:

```js
import { useEffect, useState } from "react";

// Seconds remaining until a moment; ticks once a second while positive.
export function useCountdown() {
	const [until, setUntil] = useState(0);
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (until <= Date.now()) return undefined;
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [until]);
	const secondsLeft = Math.max(0, Math.ceil((until - now) / 1000));
	return { secondsLeft, start: (seconds) => { setNow(Date.now()); setUntil(Date.now() + seconds * 1000); } };
}
```

`WorkspaceLogin.jsx`: on `error.code === "RATE_LIMITED"` call `start(error.retryAfterSeconds)`; submit button `disabled={busy || secondsLeft > 0}` with label `secondsLeft > 0 ? \`Try again in ${secondsLeft}s\` : "Next"`; the banner shows the server message. `PlaygroundPage.jsx`: same for the Evaluate button.

- [ ] **Step 7: Verify**

`bun test` → pass. Shell: 11 wrong-password logins → ten `401` then `429` with `Retry-After`; browser shows the countdown. Restart resets (documented as in-memory).

### Task 6.7: Error boundaries

**Files:**
- Create: `frontend/src/shared/components/ErrorBoundary.jsx`, `frontend/src/shared/components/ErrorBoundary.test.jsx`, `frontend/src/shared/logging/client-logger.js`
- Modify: `frontend/src/shared/components/EmptyState.jsx` (add `id` prop on the `<h2>`), `frontend/src/App.jsx`, `frontend/src/features/shell/Workspace.jsx`, `frontend/src/styles.css`

**Interfaces:**
- Produces: `ErrorBoundary` (props `fallback(error, reset)`, `resetKeys`, `onError`), `RouteErrorFallback({ error, onRetry, projectKey })`, `AppErrorFallback({ error })`, `clientLogger.{warn,error}(event, fields)`.

- [ ] **Step 1: Test**

```jsx
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppErrorFallback, ErrorBoundary, RouteErrorFallback } from "./ErrorBoundary.jsx";

describe("ErrorBoundary", () => {
	test("getDerivedStateFromError stores the error", () => {
		const error = new Error("boom");
		expect(ErrorBoundary.getDerivedStateFromError(error)).toEqual({ error });
	});
	test("renders children when nothing failed", () => {
		const html = renderToStaticMarkup(<ErrorBoundary fallback={() => <p>fallback</p>}><p>content</p></ErrorBoundary>);
		expect(html).toContain("content");
		expect(html).not.toContain("fallback");
	});
	test("route fallback names the error and offers retry and dashboard", () => {
		const html = renderToStaticMarkup(<RouteErrorFallback error={new Error("Cannot read x")} onRetry={() => {}} projectKey="storefront" />);
		expect(html).toContain('id="route-error-title"');
		expect(html).toContain("This page ran into a problem");
		expect(html).toContain("Cannot read x");
		expect(html).toContain("Try again");
		expect(html).toContain("/projects/storefront/dashboard");
	});
	test("app fallback offers a reload", () => {
		expect(renderToStaticMarkup(<AppErrorFallback error={new Error("x")} />)).toContain("Reload Rheostat");
	});
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

`EmptyState.jsx`: signature `({ action = null, description = "", icon = "info", id, title })`, `<h2 id={id}>{title}</h2>`.

`client-logger.js`:

```js
// The browser console is the frontend's log sink; entries are structured so they can be pasted into a report.
const emit = (level) => (event, fields = {}) =>
	console[level](`[rheostat] ${event}`, { ...fields, at: new Date().toISOString(), path: window.location.pathname });
export const clientLogger = { warn: emit("warn"), error: emit("error") };
```

`ErrorBoundary.jsx`:

```jsx
import { Component } from "react";
import { clientLogger } from "../logging/client-logger.js";
import { EmptyState } from "./EmptyState.jsx";
import { MaterialIcon } from "./MaterialIcon.jsx";

// Catches render errors below it; `resetKeys` clears the error when any key changes (the route path).
export class ErrorBoundary extends Component {
	state = { error: null };
	static getDerivedStateFromError(error) {
		return { error };
	}
	componentDidCatch(error, info) {
		clientLogger.error("render.failed", { message: error.message, componentStack: info?.componentStack });
		this.props.onError?.(error, info);
	}
	componentDidUpdate(previous) {
		const keys = this.props.resetKeys || [];
		const before = previous.resetKeys || [];
		if (this.state.error && (keys.length !== before.length || keys.some((key, index) => key !== before[index]))) this.reset();
	}
	reset = () => this.setState({ error: null });
	render() {
		return this.state.error ? this.props.fallback(this.state.error, this.reset) : this.props.children;
	}
}

export function RouteErrorFallback({ error, onRetry, projectKey }) {
	return (
		<section className="page" aria-labelledby="route-error-title">
			<EmptyState action={{ label: "Try again", onClick: onRetry }} description={`${error.message}. Your other pages are unaffected.`} icon="error_outline" id="route-error-title" title="This page ran into a problem" />
			<p className="route-error-links">
				<a href={`/projects/${projectKey}/dashboard`}>Go to dashboard</a>
			</p>
		</section>
	);
}

export function AppErrorFallback({ error }) {
	return (
		<main className="app-error" role="alert">
			<MaterialIcon size={40}>error_outline</MaterialIcon>
			<h1>Rheostat hit an unexpected error</h1>
			<p>{error.message}</p>
			<button className="primary-button" type="button" onClick={() => window.location.reload()}>
				Reload Rheostat
			</button>
		</main>
	);
}
```

`App.jsx`: wrap the returned tree in `<ErrorBoundary fallback={(error) => <AppErrorFallback error={error} />}>`. `Workspace.jsx`: `<ErrorBoundary fallback={(error, reset) => <RouteErrorFallback error={error} onRetry={reset} projectKey={project?.key || projects?.[0]?.key || ""} />} resetKeys={[route.path]}>{content}</ErrorBoundary>`. `styles.css`: `.app-error { display: grid; place-items: center; gap: 12px; min-height: 100vh; padding: 24px; text-align: center; background: var(--surface-muted); } .route-error-links { text-align: center; }`.

- [ ] **Step 4: Run** → 4 pass.

- [ ] **Step 5: Verify in the browser** — temporarily `throw new Error("Deliberate test failure")` at the top of `SegmentsPage`; open Segments → fallback with the message, rail works, "Try again" fails again, navigating to Flags clears it; remove the throw; "Try again" renders the page. Console shows `[rheostat] render.failed`.

### Task 6.8: Code splitting

**Files:** Modify `frontend/src/features/shell/Workspace.jsx`, `frontend/vite.config.js`.

- [ ] **Step 1: Record the baseline** — `cd frontend && bunx vite build` and note the entry chunk size (`dist/assets/index-*.js`).

- [ ] **Step 2: Lazy pages** — replace the static page imports in `Workspace.jsx` with:

```jsx
import { Suspense, lazy } from "react";
const page = (load, name) => lazy(() => load().then((module) => ({ default: module[name] })));
const FlagsPage = page(() => import("../flags/FlagsPage.jsx"), "FlagsPage");
const FlagDetailPage = page(() => import("../flags/FlagDetailPage.jsx"), "FlagDetailPage");
const SegmentsPage = page(() => import("../segments/SegmentsPage.jsx"), "SegmentsPage");
const SegmentEditorPage = page(() => import("../segments/SegmentEditorPage.jsx"), "SegmentEditorPage");
const PlaygroundPage = page(() => import("../playground/PlaygroundPage.jsx"), "PlaygroundPage");
const ChangeRequestsPage = page(() => import("../change-requests/ChangeRequestsPage.jsx"), "ChangeRequestsPage");
const ChangeRequestDetailPage = page(() => import("../change-requests/ChangeRequestDetailPage.jsx"), "ChangeRequestDetailPage");
const RolloutsPage = page(() => import("../rollouts/RolloutsPage.jsx"), "RolloutsPage");
const RolloutDetailPage = page(() => import("../rollouts/RolloutDetailPage.jsx"), "RolloutDetailPage");
const DashboardPage = page(() => import("../dashboard/DashboardPage.jsx"), "DashboardPage");
const AuditPage = page(() => import("../audit/AuditPage.jsx"), "AuditPage");
const ProjectSettingsPage = page(() => import("../projects/ProjectSettingsPage.jsx"), "ProjectSettingsPage");
const WebhookDetailPage = page(() => import("../webhooks/WebhookDetailPage.jsx"), "WebhookDetailPage");
```

and render `<ErrorBoundary …><Suspense fallback={<Skeleton rows={6} />}>{content}</Suspense></ErrorBoundary>` (boundary outside Suspense). `vite.config.js` `build`: `{ outDir: "dist", sourcemap: true, rollupOptions: { output: { manualChunks: { react: ["react", "react-dom"] } } } }`.

- [ ] **Step 3: Verify behaviourally** — `bunx vite build`: the entry chunk is smaller than the baseline (record both numbers in the log entry) and an `assets/react-*.js` chunk exists. `grep -n "from \"../flags/FlagsPage.jsx\"" frontend/src/features/shell/Workspace.jsx` → no static import. Browser (production preview or dev): open the dashboard, Network tab filtered to JS — no `FlagsPage` module loaded; navigate to Flags → a module for it loads; navigate away and back → no new JS request. Rollup may factor shared modules into extra chunks; that is not a failure.

### Task 6.9: Client cache and request deduplication

**Files:**
- Create: `frontend/src/shared/api/cache.js`, `frontend/src/shared/api/cache.test.js`, `frontend/src/shared/hooks/async-state.js`, `frontend/src/shared/hooks/async-state.test.js`
- Modify: `frontend/src/shared/hooks/useAsync.js`, `frontend/src/features/projects/project.api.js`, `frontend/src/features/segments/segment.api.js`, `frontend/src/features/profiles/profile.api.js`, `frontend/src/features/people/people.api.js`, `frontend/src/features/flags/flag.api.js`, `frontend/src/features/change-requests/change-request.api.js`, `frontend/src/features/rollouts/rollout.api.js`, `frontend/src/App.jsx`, call sites `Workspace.jsx`, `FlagDetailPage.jsx`, `SegmentEditorPage.jsx`, `PlaygroundPage.jsx`, `SegmentsPage.jsx`, `FlagsPage.jsx`, `PersonPicker.jsx`

**Interfaces:**
- Produces: `dedupe(key, loader)`, `readCache(key) → { data, at } | null`, `writeCache(key, data)`, `invalidate(prefix)`, `clearCache()`, `currentGeneration()`; `initialStateFor(key, staleMs, now)`, `settle(previous, { data | error })`; `useAsync(loader, deps, { key, staleMs }) → { data, error, loading, revalidating, reload, mutate(updater, { commit }) }`.

- [ ] **Step 1: Cache test**

```js
import { describe, expect, test } from "bun:test";
import { clearCache, currentGeneration, dedupe, invalidate, readCache, writeCache } from "./cache.js";

const later = (value, ms) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

describe("cache", () => {
	test("dedupe shares one in-flight promise per key and caches the result", async () => {
		clearCache();
		let calls = 0;
		const loader = () => later(++calls, 5);
		const [a, b] = await Promise.all([dedupe("k", loader), dedupe("k", loader)]);
		expect([a, b, calls]).toEqual([1, 1, 1]);
		expect(readCache("k").data).toBe(1);
		expect(await dedupe("k", loader)).toBe(2);
	});
	test("write, read, and prefix invalidation", () => {
		clearCache();
		writeCache("segments:storefront", [1]);
		writeCache("segments:mobile", [2]);
		writeCache("projects", []);
		invalidate("segments:");
		expect(readCache("segments:storefront")).toBeNull();
		expect(readCache("segments:mobile")).toBeNull();
		expect(readCache("projects").data).toEqual([]);
	});
	test("a failed loader is not cached and does not stay deduped", async () => {
		clearCache();
		await expect(dedupe("f", () => Promise.reject(new Error("x")))).rejects.toThrow("x");
		expect(readCache("f")).toBeNull();
		expect(await dedupe("f", () => Promise.resolve("ok"))).toBe("ok");
	});
	test("a request started before clearCache cannot populate the new generation", async () => {
		clearCache();
		const generation = currentGeneration();
		const old = dedupe("profiles", () => later(["A"], 10));
		clearCache(); // profile switch
		expect(currentGeneration()).toBe(generation + 1);
		writeCache("profiles", ["B"]);
		expect(await old).toEqual(["A"]);
		expect(readCache("profiles").data).toEqual(["B"]);
	});
	test("in-flight cleanup is identity-safe", async () => {
		clearCache();
		const slow = dedupe("k", () => later("slow", 20));
		clearCache();
		const fast = dedupe("k", () => later("fast", 1));
		await slow; // its cleanup must not delete `fast`
		expect(await dedupe("k", () => later("third", 1))).toBe("fast");
		await fast;
	});
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```js
// Module-level cache for read-mostly lists plus in-flight deduplication. Keys are explicit ("segments:storefront")
// so invalidation is deliberate. `generation` fences responses that started before a clearCache() (profile switch).
const entries = new Map();
const inflight = new Map();
let generation = 0;

export const currentGeneration = () => generation;
export const readCache = (key) => entries.get(key) || null;
export function writeCache(key, data) {
	entries.set(key, { data, at: Date.now() });
}
export function invalidate(prefix) {
	for (const key of entries.keys()) if (key.startsWith(prefix)) entries.delete(key);
}
export function clearCache() {
	entries.clear();
	inflight.clear();
	generation += 1;
}
export function dedupe(key, loader) {
	if (inflight.has(key)) return inflight.get(key);
	const startedIn = generation;
	const promise = Promise.resolve()
		.then(loader)
		.then((data) => {
			if (startedIn === generation) writeCache(key, data);
			return data;
		})
		.finally(() => {
			if (inflight.get(key) === promise) inflight.delete(key);
		});
	inflight.set(key, promise);
	return promise;
}
```

- [ ] **Step 4: Run** → 5 pass.

- [ ] **Step 5: Pure hook helpers + test**

`frontend/src/shared/hooks/async-state.js`:

```js
import { readCache } from "../api/cache.js";

// State transitions of useAsync, kept pure so they can be tested without rendering.
export function initialStateFor(key, staleMs, now = Date.now()) {
	const cached = key ? readCache(key) : null;
	if (!cached) return { data: null, error: null, loading: true, revalidating: false, fresh: false };
	const fresh = now - cached.at < staleMs;
	return { data: cached.data, error: null, loading: false, revalidating: !fresh, fresh };
}
export const starting = (previous) => ({ ...previous, error: null, loading: previous.data === null, revalidating: previous.data !== null });
export const settled = (previous, { data, error }) =>
	error ? { ...previous, error, loading: false, revalidating: false } : { data, error: null, loading: false, revalidating: false, fresh: true };
```

`async-state.test.js`:

```js
import { describe, expect, test } from "bun:test";
import { clearCache, writeCache } from "../api/cache.js";
import { initialStateFor, settled, starting } from "./async-state.js";

describe("async-state", () => {
	test("no key or no cache → loading with no data", () => {
		clearCache();
		expect(initialStateFor(null, 30000)).toMatchObject({ data: null, loading: true, revalidating: false });
		expect(initialStateFor("missing", 30000)).toMatchObject({ data: null, loading: true });
	});
	test("fresh cache → data, no loading, no revalidation; stale cache → revalidating", () => {
		clearCache();
		writeCache("k", [1]);
		expect(initialStateFor("k", 30000)).toMatchObject({ data: [1], loading: false, revalidating: false, fresh: true });
		expect(initialStateFor("k", 30000, Date.now() + 31000)).toMatchObject({ data: [1], loading: false, revalidating: true, fresh: false });
	});
	test("a key change to an uncached key drops the old data and shows loading", () => {
		clearCache();
		writeCache("a", ["A"]);
		const first = initialStateFor("a", 30000);
		const afterSwitch = initialStateFor("b", 30000);
		expect(first.data).toEqual(["A"]);
		expect(afterSwitch).toMatchObject({ data: null, loading: true });
	});
	test("starting keeps data while revalidating; settled replaces or records the error", () => {
		const s = starting({ data: [1], error: null, loading: false, revalidating: false });
		expect(s).toMatchObject({ data: [1], loading: false, revalidating: true });
		expect(settled(s, { data: [2] })).toMatchObject({ data: [2], loading: false, revalidating: false });
		expect(settled(s, { error: new Error("x") })).toMatchObject({ data: [1], loading: false, revalidating: false });
	});
});
```

- [ ] **Step 6: Run** → 4 pass.

- [ ] **Step 7: `useAsync` with explicit key-change handling**

```js
import { useCallback, useEffect, useRef, useState } from "react";
import { dedupe, writeCache } from "../api/cache.js";
import { initialStateFor, settled, starting } from "./async-state.js";

export function useAsync(loader, dependencies = [], { key = null, staleMs = 30000 } = {}) {
	const [state, setState] = useState(() => initialStateFor(key, staleMs));
	const generation = useRef(0);
	const keyRef = useRef(key);
	// A key change while mounted resets synchronously to that key's cached state (or loading), never the old key's data.
	if (keyRef.current !== key) {
		keyRef.current = key;
		generation.current += 1;
		setState(initialStateFor(key, staleMs));
	}
	const run = useCallback(async () => {
		const current = (generation.current += 1);
		setState(starting);
		try {
			const data = key ? await dedupe(key, loader) : await loader();
			if (current === generation.current) setState((previous) => settled(previous, { data }));
		} catch (error) {
			if (current === generation.current) setState((previous) => settled(previous, { error }));
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, dependencies);
	useEffect(() => {
		if (state.fresh && state.data !== null && !state.loading && !state.revalidating) return;
		run();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [run]);
	// `mutate` changes hook state. It is pure (no side effects inside the React updater), ignores calls that arrive
	// after the hook moved to another key, and a `commit` (authoritative server data) writes the cache outside the
	// updater and bumps the load generation so an older in-flight GET cannot overwrite the committed value.
	const dataRef = useRef(state.data);
	dataRef.current = state.data;
	const mutate = useCallback(
		(updater, { commit = false } = {}) => {
			if (keyRef.current !== key) return false;
			const data = typeof updater === "function" ? updater(dataRef.current) : updater;
			dataRef.current = data;
			if (commit) {
				generation.current += 1;
				if (key) writeCache(key, data);
			}
			setState((previous) => ({ ...previous, data, ...(commit ? { fresh: true } : {}) }));
			return true;
		},
		[key],
	);
	return { data: state.data, error: state.error, loading: state.loading, revalidating: state.revalidating, reload: run, mutate };
}
```

`reload` always fetches. The `fresh` flag is only true when the state came from a fresh cache entry, a completed load, or a committed mutation, so a fresh cached page skips the initial fetch and a key change to an uncached key loads. `mutate` returns `false` when ignored (stale key) so callers can skip their toast.

- [ ] **Step 7b: Mutation-race tests (pure)** — append to `async-state.test.js`:

```js
import { mutationOutcome } from "./async-state.js";

describe("mutation races", () => {
	test("a mutation callback for key A is ignored once the hook is on key B", () => {
		expect(mutationOutcome({ currentKey: "b", callbackKey: "a" })).toBe("ignored");
		expect(mutationOutcome({ currentKey: "a", callbackKey: "a" })).toBe("applied");
	});
	test("a committed mutation bumps the generation so an older GET is discarded", () => {
		const generation = { current: 3 };
		const olderGet = generation.current; // GET started before the commit
		mutationOutcome({ currentKey: "a", callbackKey: "a", commit: true, generation });
		expect(generation.current).toBe(4);
		expect(olderGet === generation.current).toBe(false); // settled() would be skipped by run()
	});
});
```

and in `async-state.js`:

```js
export function mutationOutcome({ currentKey, callbackKey, commit = false, generation = { current: 0 } }) {
	if (currentKey !== callbackKey) return "ignored";
	if (commit) generation.current += 1;
	return "applied";
}
```

`useAsync.mutate` follows exactly that logic (key check → generation bump on commit) so the pure test documents the hook's behaviour; the browser gate verifies the wiring (Task 6.10 step 6).

- [ ] **Step 8: Keys and invalidation**

`Workspace.jsx` projects → `{ key: "projects" }`; `project.api.js` `create/updateEnvironments` → `invalidate("projects")`. Segment lists (`FlagDetailPage`, `SegmentEditorPage`, `PlaygroundPage`, `SegmentsPage`) → `{ key: \`segments:${project.key}\` }`; `segment.api.js` `create/update/remove` → `invalidate(\`segments:${projectKey}\`)`. `profile.api.js` list → `"profiles"`; `people.api.js updateRole` → `invalidate("profiles")` + `invalidate("people:")`; `PersonPicker` search → `\`people:${query}\``. `FlagsPage` → `\`flags:${project.key}:${JSON.stringify(filters)}\``; `flag.api.js` every mutation, `change-request.api.js apply`, `rollout.api.js create/pause/resume/abort` → `invalidate(\`flags:${projectKey}\`)`. `App.jsx`: `clearCache()` inside `clearStoredSession` and at the start of the profile-switch handler. Lists render `Skeleton` only when `loading`; when `revalidating` they keep content and set `aria-busy="true"` on the table wrapper.

- [ ] **Step 9: Verify** — `bun test` passes. Browser: Flags → flag → back is instant; one `segments` request when opening a flag then the playground within 30 s; creating a segment updates the flag detail's segment list; switching profile mid-load (throttle the network) never shows the previous profile's data; changing project in the switcher while on Segments shows the skeleton, never the old project's list.

### Task 6.10: Optimistic updates with the cache policy

**Files:** Modify `ChangeRequestDetailPage.jsx`, `CommentThread.jsx`, `RolloutDetailPage.jsx`, `FlagDetailPage.jsx`, `styles.css`; create `frontend/src/shared/hooks/optimistic.test.js`.

**Policy (spec §5):** optimistic values in hook state only; the server response is committed with `mutate(data, { commit: true })`; failure restores the previous hook state; dependent lists are invalidated by the API module.

- [ ] **Step 1: Policy regression test (cache level)**

```js
import { describe, expect, test } from "bun:test";
import { clearCache, readCache, writeCache } from "../api/cache.js";
import { initialStateFor } from "./async-state.js";

// Simulates: page loads (cached), optimistic mutate (state only), server commit, navigate away and back.
describe("optimistic update coherence", () => {
	test("navigating back after a committed mutation shows the server value, never the optimistic guess", () => {
		clearCache();
		writeCache("cr:1", { comments: [] });
		let state = initialStateFor("cr:1", 30000).data;
		state = { ...state, comments: [{ id: "local-1", body: "hi", pending: true }] }; // optimistic: hook state only
		expect(readCache("cr:1").data.comments).toEqual([]);
		const server = { comments: [{ id: "c_9", body: "hi" }] };
		writeCache("cr:1", server); // mutate(server, { commit: true })
		expect(initialStateFor("cr:1", 30000).data).toEqual(server);
	});
	test("a failed mutation leaves the cache untouched", () => {
		clearCache();
		writeCache("cr:1", { comments: [] });
		const previous = initialStateFor("cr:1", 30000).data;
		const optimistic = { ...previous, comments: [{ id: "local", pending: true }] };
		expect(optimistic.comments).toHaveLength(1);
		expect(readCache("cr:1").data).toEqual(previous); // restore = drop the optimistic state
	});
});
```

- [ ] **Step 2: Run** → 2 pass (documents the policy; the hook wiring below follows it).

- [ ] **Step 3: Comment post** — in `ChangeRequestDetailPage.jsx` (`useAsync(() => changeRequestApi.get(id), [id], { key: \`cr:${id}\` })`):

```jsx
onSubmit={async (body) => {
	const previous = data;
	const optimistic = { id: `local-${Date.now()}`, authorId: profile._id, author: profile, body, at: new Date().toISOString(), pending: true };
	mutate((current) => ({ ...current, comments: [...current.comments, optimistic] }));
	try {
		const updated = await changeRequestApi.comment(changeRequest._id, body);
		mutate((current) => ({ ...current, ...updated, permissions: current.permissions }), { commit: true });
	} catch (caught) {
		mutate(previous);
		notify({ kind: "error", message: `Comment not posted: ${caught.message}` });
		throw caught;
	}
}}
```

`CommentThread.jsx`: `pending` comments get `className="comment comment-pending"` and a trailing `<span className="muted">Posting…</span>`; on rejection the draft stays. CSS `.comment-pending { opacity: .6; }`.

- [ ] **Step 4: Rollout pause / resume-from-paused** — in `RolloutDetailPage.jsx`:

```jsx
const transition = async (action, optimisticStatus, message) => {
	const previous = data;
	mutate((current) => ({ ...current, status: optimisticStatus }));
	setBusy(true);
	try {
		mutate(await action(), { commit: true });
		notify({ kind: "success", message });
	} catch (caught) {
		mutate(previous);
		notify({ kind: "error", message: caught.message });
	} finally {
		setBusy(false);
	}
};
```

Pause → `transition(() => rolloutApi.pause(id), "paused", "Rollout paused.")`; resume from `paused` → `transition(() => rolloutApi.resume(id), "running", "Rollout resumed.")`. Resume from `stalled` keeps its confirmation and is not optimistic.

- [ ] **Step 5: Kill-switch clear** — `FlagDetailPage.jsx` clear confirm:

```jsx
onConfirm={async () => {
	const previous = flag;
	mutate((current) => ({ ...current, killSwitch: { active: false, reason: "", actorId: null, activatedAt: null, actor: null } }));
	setDialog(null);
	try {
		await flagApi.clearKillSwitch(project.key, flag.key);
		notify({ kind: "success", message: "Kill switch cleared." });
		reload();
	} catch (caught) {
		mutate(previous);
		notify({ kind: "error", message: `Could not clear the kill switch: ${caught.message}` });
	}
}}
```

- [ ] **Step 6: Verify in the browser** — comment appears dimmed then solid; with the backend stopped it disappears with a toast and the draft stays; pause flips instantly and reverts on failure; kill-switch banner vanishes instantly; after posting a comment, navigate away and back → the server copy (no "Posting…"). Race checks: throttle the network, post a comment on change request A, immediately navigate to change request B before the POST resolves → B never shows A's comment (mutate ignored: stale key); on A, click Reload (slow GET) then post a comment that commits first → the committed comment stays when the slow GET resolves (older generation discarded).

### Phase 6 gate additions

7. Every error envelope has `requestId`; the request-id round trip (browser header → server echo → `ApiError.requestId` → banner reference) is observed for a forced 500; malformed JSON and 413 carry ids (automated).
8. Rate limits and countdown UI (Task 6.6 step 7).
9. Boundaries (Task 6.7 step 5).
10. Code splitting behavioural checks (Task 6.8 step 3).
11. Cache: instant back-navigation, dedupe, invalidation, profile-switch fence, project switch on a list page.
12. Optimistic updates roll back on failure; committed values survive navigation.

---

## Phase 6.5 — Outbound webhooks

### Task W1: Permissions, catalogue, models, sink token

**Files:**
- Create: `backend/src/features/webhooks/events-catalogue.js`, `backend/src/features/webhooks/webhook-subscription.model.js`, `backend/src/features/webhooks/webhook-delivery.model.js`, `backend/src/features/webhooks/webhook-receipt.model.js`
- Modify: `backend/src/shared/auth/permissions.js`, `backend/src/shared/auth/permissions.test.js`, `backend/src/features/projects/project.model.js`, `backend/src/features/projects/project.repository.js`, `backend/src/features/projects/project.service.js`, `backend/src/scripts/seed/projects.js`, `backend/src/scripts/seed.js`, `backend/src/features/audit/audit.model.js`, `backend/src/features/audit/audit.service.js`, `backend/src/features/people/person.service.js`

**Interfaces:**
- Produces: `WEBHOOK_EVENTS`, `EVENT_GROUPS`; models `WebhookSubscription`, `WebhookDelivery` (statuses `pending|held|delivering|delivered|dead`, field `budgetFrom`), `WebhookReceipt` (unique `(projectId, dedupeKey)`, `receivedCount`); permissions `webhook:read` (everyone), `webhook:manage` (release manager, admin); `project.webhookSink.token`; `projectRepository.findBySinkToken(token)`; `SYSTEM_ACTOR` and `AuditEntry.actorKind` (`shared/auth/system-actor.js`).

- [ ] **Step 1: Permission test** — append to `permissions.test.js`:

```js
	test("webhooks: everyone reads, release managers and admins manage", () => {
		expect(can("viewer", "webhook:read")).toBe(true);
		expect(can("developer", "webhook:manage")).toBe(false);
		expect(can("reviewer", "webhook:manage")).toBe(false);
		expect(can("releaseManager", "webhook:manage")).toBe(true);
		expect(can("admin", "webhook:manage")).toBe(true);
		expect(permissionsFor("releaseManager")).toContain("webhook:manage");
		expect(permissionsFor("viewer")).toContain("webhook:read");
	});
```

- [ ] **Step 2: Run** → FAIL. **Step 3:** add `"webhook:read": EVERYONE,` and `"webhook:manage": RELEASE,` to `PERMISSIONS`. **Step 4: Run** → pass.

- [ ] **Step 5: Catalogue**

```js
export const EVENT_GROUPS = {
	flag: ["flag.config.updated", "flag.killSwitch.activated", "flag.killSwitch.cleared", "flag.archived", "flag.restored"],
	changeRequest: ["changeRequest.applied"],
	rollout: ["rollout.stepApplied", "rollout.stalled", "rollout.completed", "rollout.aborted"],
	webhook: ["webhook.test"],
};
export const WEBHOOK_EVENTS = Object.values(EVENT_GROUPS).flat();
```

- [ ] **Step 6: Models**

`webhook-subscription.model.js`:

```js
import mongoose from "mongoose";
import { ENVIRONMENT_KEYS } from "../projects/project.model.js";
import { WEBHOOK_EVENTS } from "./events-catalogue.js";

export const DISABLED_REASONS = ["AUTO_FAILURES", "MANUAL"];

const subscriptionSchema = new mongoose.Schema(
	{
		projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
		name: { type: String, required: true, trim: true, maxlength: 80 },
		url: { type: String, required: true, maxlength: 500 },
		secret: { type: String, required: true },
		events: { type: [{ type: String, enum: WEBHOOK_EVENTS }], required: true, validate: (value) => value.length > 0 },
		environments: { type: [{ type: String, enum: ENVIRONMENT_KEYS }], default: [] },
		enabled: { type: Boolean, default: true },
		disabledReason: { type: String, enum: [...DISABLED_REASONS, null], default: null },
		consecutiveFailures: { type: Number, default: 0 },
		lastDeliveryAt: { type: Date, default: null },
		lastDeliveryStatus: { type: String, enum: ["delivered", "dead", null], default: null },
		createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Person", required: true },
	},
	{ timestamps: true, versionKey: false },
);
subscriptionSchema.index({ projectId: 1, createdAt: -1 });
export const WebhookSubscription = mongoose.model("WebhookSubscription", subscriptionSchema);
```

`webhook-delivery.model.js`:

```js
import mongoose from "mongoose";

export const DELIVERY_STATUSES = ["pending", "held", "delivering", "delivered", "dead"];

const attemptSchema = new mongoose.Schema(
	{
		at: { type: Date, required: true },
		outcome: { type: String, enum: ["delivered", "failed"], required: true },
		durationMs: { type: Number, required: true },
		responseStatus: { type: Number, default: undefined },
		responseSnippet: { type: String, default: undefined, maxlength: 500 },
		error: { type: String, default: undefined, maxlength: 300 },
	},
	{ _id: false },
);

const deliverySchema = new mongoose.Schema(
	{
		subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: "WebhookSubscription", required: true },
		projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
		eventId: { type: String, required: true },
		event: { type: String, required: true },
		payload: { type: mongoose.Schema.Types.Mixed, required: true },
		status: { type: String, enum: DELIVERY_STATUSES, required: true, default: "pending" },
		attempts: { type: [attemptSchema], default: [] },
		budgetFrom: { type: Number, default: 0 },
		nextAttemptAt: { type: Date, required: true },
		claimedAt: { type: Date, default: null },
		deliveredAt: { type: Date, default: null },
	},
	{ timestamps: true, versionKey: false, minimize: false },
);
deliverySchema.index({ subscriptionId: 1, eventId: 1 }, { unique: true });
deliverySchema.index({ status: 1, nextAttemptAt: 1 });
deliverySchema.index({ subscriptionId: 1, createdAt: -1, _id: -1 });
deliverySchema.index({ projectId: 1, status: 1 });
export const WebhookDelivery = mongoose.model("WebhookDelivery", deliverySchema);
```

`webhook-receipt.model.js` — one document per logical delivery; the unique `(projectId, dedupeKey)` index makes duplicate detection atomic:

```js
import mongoose from "mongoose";

const receiptSchema = new mongoose.Schema(
	{
		projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
		subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: "WebhookSubscription", default: null },
		dedupeKey: { type: String, required: true },
		deliveryId: { type: String, required: true },
		event: { type: String, required: true },
		firstReceivedAt: { type: Date, required: true },
		lastReceivedAt: { type: Date, required: true },
		receivedCount: { type: Number, required: true, default: 1 },
		headers: { type: mongoose.Schema.Types.Mixed, default: {} },
		body: { type: String, required: true, maxlength: 16384 },
		signatureValid: { type: Boolean, required: true },
		signatureError: { type: String, default: "" },
	},
	{ timestamps: false, versionKey: false, minimize: false },
);
receiptSchema.index({ projectId: 1, dedupeKey: 1 }, { unique: true });
receiptSchema.index({ projectId: 1, lastReceivedAt: -1 });
export const WebhookReceipt = mongoose.model("WebhookReceipt", receiptSchema);
```

`backend/src/shared/auth/system-actor.js`:

```js
import mongoose from "mongoose";

// Automated writers (webhook worker, rollout steps) record this actor; it is a constant, not a Person document.
export const SYSTEM_ACTOR_ID = new mongoose.Types.ObjectId("000000000000000000000001");
export const SYSTEM_ACTOR = { _id: SYSTEM_ACTOR_ID, name: "Rheostat", system: true };
export const isSystemActor = (id) => String(id) === String(SYSTEM_ACTOR_ID);
```

`audit.model.js`: add `actorKind: { type: String, enum: ["user", "system"], default: "user" }`. `audit.service.js` `toEntry`: `actorKind: actorKind || (actor.system ? "system" : "user")` (accept an `actorKind` input field). `person.service.js` `findMany`: prepend `SYSTEM_ACTOR` to the result when `ids` includes the sentinel, so `attachActors` resolves it to `{ _id, name: "Rheostat", system: true }`. `seed/rollouts.js` and `reconcile.js`: rollout step/stall/complete entries pass `actorKind: "system"` (actor stays `plan.createdBy`, spec §4.6).

- [ ] **Step 7: Project sink token** — `project.model.js`: `webhookSink: { token: { type: String, required: true } }`. `project.repository.js`: `findBySinkToken: (token) => Project.findOne({ "webhookSink.token": token }).lean(),`. `project.service.js create`: `webhookSink: { token: randomBytes(16).toString("hex") }` (`import { randomBytes } from "node:crypto"`). `scripts/seed/projects.js`: storefront token `a3f1c9d2e8b74650a1c2d3e4f5061728`, mobile token `b7e2d4c6a1f93850c2d3e4f506172839`. `seed.js`: add `WebhookSubscription, WebhookDelivery, WebhookReceipt` to `models` after `RolloutPlan`, and labels `"Webhooks"`, `"Deliveries"`, `"Receipts"` after `"Rollout plans"`.

- [ ] **Step 8: Verify** — `bun test` passes; `bun run seed` prints `Webhooks: 0`, `Deliveries: 0`, `Receipts: 0`; `mongosh rheostat_db --quiet --eval 'db.projects.findOne({key:"storefront"}).webhookSink.token'` prints the token; `db.auditentries.countDocuments({actorKind:"system"})` equals the number of seeded rollout step/complete entries (9).

### Task W2: Signature module

**Files:** Create `backend/src/features/webhooks/signature.js`, `backend/src/features/webhooks/signature.test.js`.

**Interfaces:** `sign(secret, body, timestampSeconds) → "t=<ts>,v1=<hex>"`; `verify(secret, body, header, { nowSeconds, toleranceSeconds = 300 }) → { valid: true } | { valid: false, error: "malformed" | "expired" | "mismatch" }`.

- [ ] **Step 1: Test**

```js
import { describe, expect, test } from "bun:test";
import { sign, verify } from "./signature.js";

describe("webhook signature", () => {
	const secret = "s3cret";
	const body = '{"id":"1"}';
	test("round-trips", () => {
		const header = sign(secret, body, 1700000000);
		expect(header).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);
		expect(verify(secret, body, header, { nowSeconds: 1700000010 })).toEqual({ valid: true });
	});
	test("rejects a mismatched secret or body", () => {
		const header = sign(secret, body, 1700000000);
		expect(verify("other", body, header, { nowSeconds: 1700000010 })).toEqual({ valid: false, error: "mismatch" });
		expect(verify(secret, '{"id":"2"}', header, { nowSeconds: 1700000010 })).toEqual({ valid: false, error: "mismatch" });
	});
	test("rejects stale timestamps and malformed headers", () => {
		const header = sign(secret, body, 1700000000);
		expect(verify(secret, body, header, { nowSeconds: 1700000301 })).toEqual({ valid: false, error: "expired" });
		expect(verify(secret, body, "nope", { nowSeconds: 1 })).toEqual({ valid: false, error: "malformed" });
		expect(verify(secret, body, undefined, { nowSeconds: 1 })).toEqual({ valid: false, error: "malformed" });
	});
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**

```js
import { createHmac, timingSafeEqual } from "node:crypto";

// Stripe-style: HMAC-SHA256 over "<timestamp>.<body>" as "t=<ts>,v1=<hex>". The timestamp lets a receiver
// reject replays; the constant-time compare avoids timing leaks.
const digest = (secret, body, timestamp) => createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

export const sign = (secret, body, timestampSeconds) => `t=${timestampSeconds},v1=${digest(secret, body, timestampSeconds)}`;

export function verify(secret, body, header, { nowSeconds, toleranceSeconds = 300 }) {
	const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header || "");
	if (!match) return { valid: false, error: "malformed" };
	const timestamp = Number(match[1]);
	if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return { valid: false, error: "expired" };
	const expected = Buffer.from(digest(secret, body, timestamp), "hex");
	const received = Buffer.from(match[2], "hex");
	if (expected.length !== received.length || !timingSafeEqual(expected, received)) return { valid: false, error: "mismatch" };
	return { valid: true };
}
```

- [ ] **Step 4: Run** → 3 pass.

### Task W3: Repository, cursor, fan-out, enqueue/emit

**Files:**
- Create: `backend/src/features/webhooks/cursor.js`, `backend/src/features/webhooks/cursor.test.js`, `backend/src/features/webhooks/fanout.js`, `backend/src/features/webhooks/fanout.test.js`, `backend/src/features/webhooks/webhook.repository.js`, `backend/src/features/webhooks/events.js`, `backend/src/features/webhooks/events.test.js`, `backend/src/features/webhooks/webhook.repository.integration.test.js`

**Interfaces:**
- Produces: `encodeCursor({ createdAt, _id })`, `decodeCursor(string) → { createdAt: Date, id: string } | null`, `cursorPredicate(cursor) → mongo filter`; `fanout({ subscriptions, event, environment, eventId, payload, projectId, now, onlySubscriptionId })`; `createEvents({ subscriptions, deliveries, projects, log, dispatchNow })` → `{ enqueue(input) → Promise<deliveryDocs[]> (throws), emit(input) → Promise<{ enqueued }> (never throws) }`; default `webhookEvents` and `setDispatcher(fn)`; repositories `subscriptionRepository`, `deliveryRepository`, `receiptRepository` with the exact functions in step 7.

- [ ] **Step 1: Cursor test**

```js
import { describe, expect, test } from "bun:test";
import { cursorPredicate, decodeCursor, encodeCursor } from "./cursor.js";

describe("compound cursor", () => {
	test("round-trips createdAt and id", () => {
		const cursor = encodeCursor({ createdAt: new Date("2026-09-21T10:00:00.000Z"), _id: "6aae6f0f24551d7c9a1f37a5" });
		expect(decodeCursor(cursor)).toEqual({ createdAt: new Date("2026-09-21T10:00:00.000Z"), id: "6aae6f0f24551d7c9a1f37a5" });
	});
	test("rejects garbage", () => {
		expect(decodeCursor("nope")).toBeNull();
		expect(decodeCursor("2026-09-21T10:00:00.000Z_zzz")).toBeNull();
	});
	test("predicate orders by createdAt then _id", () => {
		const predicate = cursorPredicate({ createdAt: new Date("2026-09-21T10:00:00.000Z"), id: "6aae6f0f24551d7c9a1f37a5" });
		expect(predicate).toEqual({
			$or: [{ createdAt: { $lt: new Date("2026-09-21T10:00:00.000Z") } }, { createdAt: new Date("2026-09-21T10:00:00.000Z"), _id: { $lt: "6aae6f0f24551d7c9a1f37a5" } }],
		});
	});
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement `cursor.js`**

```js
import mongoose from "mongoose";

// Opaque "<createdAt ISO>_<ObjectId>" cursor. Two fields, because createdAt alone is not unique.
export const encodeCursor = (row) => `${new Date(row.createdAt).toISOString()}_${String(row._id)}`;

export function decodeCursor(value) {
	const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)_([0-9a-f]{24})$/.exec(value || "");
	if (!match) return null;
	const createdAt = new Date(match[1]);
	return Number.isNaN(createdAt.getTime()) ? null : { createdAt, id: match[2] };
}

export const cursorPredicate = ({ createdAt, id }) => ({ $or: [{ createdAt: { $lt: createdAt } }, { createdAt, _id: { $lt: id } }] });

export const toObjectIdPredicate = ({ createdAt, id }) => cursorPredicate({ createdAt, id: new mongoose.Types.ObjectId(id) });
```

- [ ] **Step 4: Run** → 3 pass.

- [ ] **Step 5: Fan-out test**

```js
import { describe, expect, test } from "bun:test";
import { fanout } from "./fanout.js";

const now = new Date("2026-09-21T10:00:00Z");
const sub = (overrides) => ({ _id: "s1", enabled: true, events: ["flag.config.updated"], environments: [], ...overrides });
const base = { event: "flag.config.updated", environment: "production", eventId: "e1", payload: { id: "e1" }, projectId: "p1", now };

describe("fanout", () => {
	test("one pending delivery per enabled subscription that lists the event", () => {
		const docs = fanout({ ...base, subscriptions: [sub(), sub({ _id: "s2", events: ["rollout.stalled"] }), sub({ _id: "s3", enabled: false })] });
		expect(docs.map((doc) => doc.subscriptionId)).toEqual(["s1"]);
		expect(docs[0]).toMatchObject({ status: "pending", eventId: "e1", event: "flag.config.updated", nextAttemptAt: now, attempts: [], budgetFrom: 0 });
	});
	test("environment filters apply only to events that carry an environment", () => {
		const docs = fanout({ ...base, subscriptions: [sub({ environments: ["staging"] }), sub({ _id: "s2", environments: ["production"] })] });
		expect(docs.map((doc) => doc.subscriptionId)).toEqual(["s2"]);
		const flagLevel = fanout({ ...base, event: "flag.archived", environment: null, subscriptions: [sub({ events: ["flag.archived"], environments: ["staging"] })] });
		expect(flagLevel).toHaveLength(1);
	});
	test("onlySubscriptionId restricts fan-out and webhook.test ignores the event filter", () => {
		const docs = fanout({ ...base, event: "webhook.test", subscriptions: [sub(), sub({ _id: "s2" })], onlySubscriptionId: "s2" });
		expect(docs.map((doc) => doc.subscriptionId)).toEqual(["s2"]);
	});
});
```

- [ ] **Step 6: Run** → FAIL. Implement `fanout.js`:

```js
// Which subscriptions receive an event. Disabled subscriptions get nothing; environment filters apply only when
// the event carries an environment; `webhook.test` targets one subscription regardless of its event list.
export function fanout({ subscriptions, event, environment = null, eventId, payload, projectId, now, onlySubscriptionId = null }) {
	return subscriptions
		.filter((subscription) => subscription.enabled)
		.filter((subscription) => !onlySubscriptionId || String(subscription._id) === String(onlySubscriptionId))
		.filter((subscription) => event === "webhook.test" || subscription.events.includes(event))
		.filter((subscription) => !environment || subscription.environments.length === 0 || subscription.environments.includes(environment))
		.map((subscription) => ({
			subscriptionId: subscription._id,
			projectId,
			eventId,
			event,
			payload,
			status: "pending",
			attempts: [],
			budgetFrom: 0,
			nextAttemptAt: now,
			claimedAt: null,
			deliveredAt: null,
		}));
}
```

Run → 3 pass.

- [ ] **Step 7: Repository**

`webhook.repository.js`:

```js
import { toObjectIdPredicate } from "./cursor.js";
import { WebhookDelivery } from "./webhook-delivery.model.js";
import { WebhookReceipt } from "./webhook-receipt.model.js";
import { WebhookSubscription } from "./webhook-subscription.model.js";

export const subscriptionRepository = {
	findById: (id) => WebhookSubscription.findById(id).lean(),
	findByProject: (projectId) => WebhookSubscription.find({ projectId }).sort({ createdAt: -1 }).lean(),
	findEnabledByProject: (projectId) => WebhookSubscription.find({ projectId, enabled: true }).lean(),
	findDisabledIds: () => WebhookSubscription.find({ enabled: false }).select("_id").lean().then((rows) => rows.map((row) => row._id)),
	countByProject: (projectId) => WebhookSubscription.countDocuments({ projectId }),
	create: (input) => WebhookSubscription.create(input).then((document) => document.toObject()),
	update: (id, patch) => WebhookSubscription.findByIdAndUpdate(id, { $set: patch }, { new: true, runValidators: true }).lean(),
	remove: (id) => WebhookSubscription.deleteOne({ _id: id }),
	recordOutcome: (id, outcome, at) =>
		WebhookSubscription.findByIdAndUpdate(
			id,
			outcome === "delivered"
				? { $set: { consecutiveFailures: 0, lastDeliveryAt: at, lastDeliveryStatus: "delivered" } }
				: { $inc: { consecutiveFailures: 1 }, $set: { lastDeliveryAt: at, lastDeliveryStatus: "dead" } },
			{ new: true },
		).lean(),
	disableAuto: (id) =>
		WebhookSubscription.updateOne({ _id: id, enabled: true }, { $set: { enabled: false, disabledReason: "AUTO_FAILURES" } }).then((result) => result.modifiedCount === 1),
	insertMany: (documents) => WebhookSubscription.insertMany(documents),
};

export const deliveryRepository = {
	findById: (id) => WebhookDelivery.findById(id).lean(),
	// Ordered:false so duplicates (unique subscriptionId+eventId) are skipped, not fatal; returns the inserted docs.
	insertMany: async (documents) => {
		try {
			return await WebhookDelivery.insertMany(documents, { ordered: false });
		} catch (error) {
			if (error?.code === 11000 || error?.writeErrors?.every((entry) => entry.code === 11000)) return error.insertedDocs || [];
			throw error;
		}
	},
	// Disabled subscriptions are excluded at claim time so their backlog cannot consume the pass budget.
	claimNext: (now, excludeSubscriptionIds = []) =>
		WebhookDelivery.findOneAndUpdate(
			{ status: "pending", nextAttemptAt: { $lte: now }, ...(excludeSubscriptionIds.length ? { subscriptionId: { $nin: excludeSubscriptionIds } } : {}) },
			{ $set: { status: "delivering", claimedAt: now } },
			{ new: true, sort: { nextAttemptAt: 1 } },
		).lean(),
	claimById: (id, now) =>
		WebhookDelivery.findOneAndUpdate({ _id: id, status: "pending" }, { $set: { status: "delivering", claimedAt: now } }, { new: true }).lean(),
	releaseStale: (before) => WebhookDelivery.updateMany({ status: "delivering", claimedAt: { $lt: before } }, { $set: { status: "pending", claimedAt: null } }),
	finish: (id, patch) => WebhookDelivery.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean(),
	requeue: (id, now, budgetFrom) =>
		WebhookDelivery.findByIdAndUpdate(id, { $set: { status: "pending", nextAttemptAt: now, claimedAt: null, budgetFrom } }, { new: true }).lean(),
	holdPending: (subscriptionId) => WebhookDelivery.updateMany({ subscriptionId, status: "pending" }, { $set: { status: "held" } }),
	releaseHeld: (subscriptionId, now) => WebhookDelivery.updateMany({ subscriptionId, status: "held" }, { $set: { status: "pending", nextAttemptAt: now } }),
	findPage: (subscriptionId, { status, cursor, limit }) =>
		WebhookDelivery.find({ subscriptionId, ...(status ? { status } : {}), ...(cursor ? toObjectIdPredicate(cursor) : {}) })
			.sort({ createdAt: -1, _id: -1 })
			.limit(limit + 1)
			.lean(),
	countByStatus: (filter) => WebhookDelivery.aggregate([{ $match: filter }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
	removeForSubscription: (subscriptionId) => WebhookDelivery.deleteMany({ subscriptionId }),
	insertManySeed: (documents) => WebhookDelivery.insertMany(documents),
};

export const receiptRepository = {
	// One atomic upsert per request: the first receipt for a dedupeKey is inserted, later ones increment receivedCount.
	// A concurrent upsert race on the unique index surfaces as 11000; one retry resolves it.
	record: async (document, attempt = 0) => {
		try {
			const receipt = await WebhookReceipt.findOneAndUpdate(
				{ projectId: document.projectId, dedupeKey: document.dedupeKey },
				{ $setOnInsert: { ...document, firstReceivedAt: document.lastReceivedAt, receivedCount: 0 }, $set: { lastReceivedAt: document.lastReceivedAt }, $inc: { receivedCount: 1 } },
				{ upsert: true, new: true },
			).lean();
			const extra = await WebhookReceipt.find({ projectId: document.projectId }).sort({ lastReceivedAt: -1 }).skip(50).select("_id").lean();
			if (extra.length) await WebhookReceipt.deleteMany({ _id: { $in: extra.map((entry) => entry._id) } });
			return receipt;
		} catch (error) {
			if (error?.code === 11000 && attempt === 0) return receiptRepository.record(document, 1);
			throw error;
		}
	},
	findRecent: (projectId) => WebhookReceipt.find({ projectId }).sort({ lastReceivedAt: -1 }).limit(50).lean(),
	clear: (projectId) => WebhookReceipt.deleteMany({ projectId }),
	insertMany: (documents) => WebhookReceipt.insertMany(documents),
};
```

- [ ] **Step 8: Events test (fakes)**

`events.test.js`:

```js
import { describe, expect, test } from "bun:test";
import { createEvents } from "./events.js";

const project = { _id: "p1", key: "storefront", name: "Storefront" };
const sub = (overrides) => ({ _id: "s1", projectId: "p1", enabled: true, events: ["flag.archived"], environments: [], ...overrides });
function harness({ subscriptions = [sub()], insertImpl } = {}) {
	const state = { inserted: [], logs: [], dispatched: 0 };
	const events = createEvents({
		subscriptions: { findEnabledByProject: async () => subscriptions },
		deliveries: { insertMany: insertImpl || (async (docs) => { state.inserted.push(...docs); return docs.map((doc, index) => ({ ...doc, _id: `d${state.inserted.length - docs.length + index + 1}` })); }) },
		log: { error: (event, fields) => state.logs.push({ event, ...fields }), warn: (event, fields) => state.logs.push({ event, ...fields }) },
		dispatchNow: async () => { state.dispatched += 1; },
	});
	return { state, events };
}

describe("webhook events", () => {
	test("enqueue returns the inserted deliveries and kicks the dispatcher", async () => {
		const h = harness();
		const docs = await h.events.enqueue({ event: "flag.archived", eventId: "audit:a1", project, flag: { key: "f", name: "F" }, data: { actorId: "a" } });
		expect(docs).toHaveLength(1);
		expect(docs[0]._id).toBe("d1");
		expect(docs[0].eventId).toBe("audit:a1");
		expect(docs[0].payload).toMatchObject({ event: "flag.archived", project: { key: "storefront", name: "Storefront" }, flag: { key: "f", name: "F" }, data: { actorId: "a" } });
		await Promise.resolve();
		expect(h.state.dispatched).toBe(1);
	});
	test("a failing dispatch kick does not change the enqueue result and is logged separately", async () => {
		const h = harness();
		h.events.__setDispatch(async () => { throw new Error("kick failed"); });
		expect(await h.events.emit({ event: "flag.archived", eventId: "audit:a2", project })).toEqual({ enqueued: 1 });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(h.state.logs.map((line) => line.event)).toEqual(["webhook.dispatch.kick.failed"]);
	});
	test("business events must carry a deterministic id; only webhook.test may omit it", async () => {
		const h = harness();
		await expect(h.events.enqueue({ event: "flag.archived", project })).rejects.toThrow("eventId is required");
		await expect(h.events.enqueue({ event: "webhook.test", project, onlySubscriptionId: "s1" })).resolves.toBeDefined();
	});
	test("enqueue with no matching subscription returns [] without dispatching", async () => {
		const h = harness({ subscriptions: [sub({ events: ["rollout.stalled"] })] });
		expect(await h.events.enqueue({ event: "flag.archived", eventId: "audit:a3", project })).toEqual([]);
		expect(h.state.dispatched).toBe(0);
	});
	test("enqueue throws on insert failure; emit swallows and logs it", async () => {
		const h = harness({ insertImpl: async () => { throw new Error("db down"); } });
		await expect(h.events.enqueue({ event: "flag.archived", eventId: "audit:a4", project })).rejects.toThrow("db down");
		expect(await h.events.emit({ event: "flag.archived", eventId: "e7", project })).toEqual({ enqueued: 0 });
		expect(h.state.logs[0]).toMatchObject({ event: "webhook.emit.failed", eventId: "e7" });
	});
	test("unknown events are rejected", async () => {
		const h = harness();
		await expect(h.events.enqueue({ event: "nope", eventId: "x", project })).rejects.toThrow("Unknown webhook event");
	});
});
```

- [ ] **Step 9: Run** → FAIL. Implement `events.js`:

```js
import { randomUUID } from "node:crypto";
import { logger } from "../../shared/logging/logger.js";
import { WEBHOOK_EVENTS } from "./events-catalogue.js";
import { fanout } from "./fanout.js";
import { deliveryRepository, subscriptionRepository } from "./webhook.repository.js";

export function createEvents({ subscriptions, deliveries, log = logger, dispatchNow = async () => {} }) {
	let kick = dispatchNow;
	const buildPayload = ({ event, eventId, project, environment, flag, data, occurredAt }) => ({
		id: eventId,
		event,
		occurredAt: occurredAt.toISOString(),
		project: { key: project.key, name: project.name },
		...(environment ? { environment } : {}),
		...(flag ? { flag: { key: flag.key, name: flag.name } } : {}),
		data,
	});
	return {
		__setDispatch(fn) {
			kick = fn;
		},
		// Inserts one delivery per matching subscription and returns exactly those documents. Throws on failure.
		// Enqueue success is the insert; the dispatch kick afterwards is fire-and-forget and logged on its own.
		// Business events carry deterministic ids (spec §9.2); only webhook.test may use a random one.
		async enqueue({ event, eventId, project, environment = null, flag = null, data = {}, occurredAt = new Date(), onlySubscriptionId = null }) {
			if (!WEBHOOK_EVENTS.includes(event)) throw new Error(`Unknown webhook event ${event}`);
			if (!eventId && event !== "webhook.test") throw new Error(`eventId is required for ${event}`);
			const id = eventId || `test:${randomUUID()}`;
			const candidates = await subscriptions.findEnabledByProject(project._id);
			const payload = buildPayload({ event, eventId: id, project, environment, flag, data, occurredAt });
			const docs = fanout({ subscriptions: candidates, event, environment, eventId: id, payload, projectId: project._id, now: occurredAt, onlySubscriptionId });
			if (!docs.length) return [];
			const inserted = await deliveries.insertMany(docs);
			Promise.resolve()
				.then(() => kick())
				.catch((error) => log.warn("webhook.dispatch.kick.failed", { eventId: id, error }));
			return inserted;
		},
		// Best-effort wrapper for owning services: never throws, logs the failure with the event id.
		async emit(input) {
			try {
				return { enqueued: (await this.enqueue(input)).length };
			} catch (error) {
				log.error("webhook.emit.failed", { event: input.event, eventId: input.eventId || null, error });
				return { enqueued: 0 };
			}
		},
	};
}

let dispatchNow = async () => {};
export const setDispatcher = (fn) => {
	dispatchNow = fn;
};
export const webhookEvents = createEvents({ subscriptions: subscriptionRepository, deliveries: deliveryRepository, dispatchNow: () => dispatchNow().catch((error) => logger.warn("webhook.dispatch.failed", { error })) });
```

Run → 4 pass.

- [ ] **Step 10: Mongo integration test (opt-in)**

`webhook.repository.integration.test.js`:

```js
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import mongoose from "mongoose";

const uri = process.env.MONGODB_TEST_URI;
const { deliveryRepository } = await import("./webhook.repository.js");
const { WebhookDelivery } = await import("./webhook-delivery.model.js");
const { decodeCursor, encodeCursor } = await import("./cursor.js");

const sid = new mongoose.Types.ObjectId();
const pid = new mongoose.Types.ObjectId();
const doc = (eventId, extra = {}) => ({ subscriptionId: sid, projectId: pid, eventId, event: "flag.archived", payload: {}, status: "pending", attempts: [], budgetFrom: 0, nextAttemptAt: new Date(0), claimedAt: null, deliveredAt: null, ...extra });

describe.skipIf(!uri)("webhook delivery repository (Mongo)", () => {
	beforeAll(async () => {
		await mongoose.connect(uri);
		await WebhookDelivery.deleteMany({});
		await WebhookDelivery.syncIndexes();
	});
	afterAll(async () => {
		await WebhookDelivery.deleteMany({});
		await mongoose.disconnect();
	});
	test("two concurrent claimNext calls yield exactly one claimant", async () => {
		await WebhookDelivery.insertMany([doc("race")]);
		const now = new Date();
		const [a, b] = await Promise.all([deliveryRepository.claimNext(now), deliveryRepository.claimNext(now)]);
		expect([a, b].filter(Boolean)).toHaveLength(1);
		expect((await WebhookDelivery.countDocuments({ status: "delivering" }))).toBe(1);
	});
	test("duplicate (subscriptionId, eventId) inserts are skipped, not fatal", async () => {
		const first = await deliveryRepository.insertMany([doc("dup")]);
		const second = await deliveryRepository.insertMany([doc("dup"), doc("fresh")]);
		expect(first).toHaveLength(1);
		expect(second.map((entry) => entry.eventId)).toEqual(["fresh"]);
		expect(await WebhookDelivery.countDocuments({ eventId: "dup" })).toBe(1);
	});
	test("compound cursor pages rows that share createdAt without skipping or repeating", async () => {
		const createdAt = new Date("2026-09-21T10:00:00.000Z");
		await WebhookDelivery.deleteMany({});
		await WebhookDelivery.insertMany(Array.from({ length: 5 }, (_, index) => ({ ...doc(`same-${index}`), createdAt, updatedAt: createdAt })));
		const seen = [];
		let cursor = null;
		for (;;) {
			const rows = await deliveryRepository.findPage(sid, { cursor: cursor ? decodeCursor(cursor) : null, limit: 2 });
			const page = rows.slice(0, 2);
			seen.push(...page.map((row) => row.eventId));
			if (rows.length <= 2) break;
			cursor = encodeCursor(page.at(-1));
		}
		expect(seen.sort()).toEqual(["same-0", "same-1", "same-2", "same-3", "same-4"]);
		expect(new Set(seen).size).toBe(5);
	});
});
```

- [ ] **Step 11: Verify** — `bun test` (no Mongo) → the integration file reports skipped; `MONGODB_TEST_URI=mongodb://localhost:27017/rheostat_test bun test backend/src/features/webhooks/webhook.repository.integration.test.js` → 3 pass.

### Task W4: Dispatcher (pure, fakes)

**Files:** Create `backend/src/features/webhooks/dispatch.js`, `backend/src/features/webhooks/dispatch.test.js`.

**Interfaces:**
- Produces: `BACKOFF_MS = [0, 30000, 120000, 300000, 900000]`, `MAX_ATTEMPTS = 5`, `BREAKER_THRESHOLD = 5`, `headersFor(subscription, delivery, body, timestampSeconds)`, `createDispatcher({ deliveries, subscriptions, send, audit, log, clock = () => performance.now(), staleClaimMs = 60000, maxPerPass = 20 }) → { dispatchDue(now) → { sent, delivered, failed }, dispatchOne(id, now) → "delivered" | "failed" | "held" | "missing" }`.
- Consumes dep shapes: `deliveries = { releaseStale(before), claimNext(now, excludeSubscriptionIds), claimById(id, now), finish(id, patch), holdPending(subscriptionId) }`, `subscriptions = { findById(id), findDisabledIds(), recordOutcome(id, outcome, at), disableAuto(id) }`, `send(url, body, headers) → { status, snippet }` (throws on network error / timeout — `error.name === "TimeoutError"` for timeouts), `audit = { record(entry) }` (automated entries use `SYSTEM_ACTOR`, `actorKind: "system"`).

- [ ] **Step 1: Test**

```js
import { describe, expect, test } from "bun:test";
import { BACKOFF_MS, createDispatcher, headersFor } from "./dispatch.js";
import { verify } from "./signature.js";

const NOW = new Date("2026-09-21T10:00:00Z");
const at = (offsetMs) => new Date(NOW.getTime() + offsetMs);

function harness({ deliveries = [], subscriptions = [], sendImpl, clockStep = 12 } = {}) {
	const state = { deliveries: structuredClone(deliveries), subscriptions: structuredClone(subscriptions), audit: [], sends: [], clock: 0 };
	const find = (id) => state.deliveries.find((entry) => String(entry._id) === String(id));
	const subOf = (id) => state.subscriptions.find((entry) => String(entry._id) === String(id));
	const deps = {
		deliveries: {
			releaseStale: async (before) => { for (const entry of state.deliveries) if (entry.status === "delivering" && entry.claimedAt < before) Object.assign(entry, { status: "pending", claimedAt: null }); },
			claimNext: async (now, exclude = []) => {
				const excluded = new Set(exclude.map(String));
				const entry = state.deliveries.filter((d) => d.status === "pending" && d.nextAttemptAt <= now && !excluded.has(String(d.subscriptionId))).sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)[0];
				if (!entry) return null;
				Object.assign(entry, { status: "delivering", claimedAt: now });
				return structuredClone(entry);
			},
			claimById: async (id, now) => {
				const entry = find(id);
				if (!entry || entry.status !== "pending") return null;
				Object.assign(entry, { status: "delivering", claimedAt: now });
				return structuredClone(entry);
			},
			finish: async (id, patch) => Object.assign(find(id), patch),
			holdPending: async (subscriptionId) => { for (const entry of state.deliveries) if (String(entry.subscriptionId) === String(subscriptionId) && entry.status === "pending") entry.status = "held"; },
		},
		subscriptions: {
			findById: async (id) => structuredClone(subOf(id) || null),
			findDisabledIds: async () => state.subscriptions.filter((s) => !s.enabled).map((s) => s._id),
			recordOutcome: async (id, outcome, when) => {
				const s = subOf(id);
				Object.assign(s, outcome === "delivered" ? { consecutiveFailures: 0, lastDeliveryStatus: "delivered", lastDeliveryAt: when } : { consecutiveFailures: s.consecutiveFailures + 1, lastDeliveryStatus: "dead", lastDeliveryAt: when });
				return structuredClone(s);
			},
			disableAuto: async (id) => { const s = subOf(id); if (!s.enabled) return false; Object.assign(s, { enabled: false, disabledReason: "AUTO_FAILURES" }); return true; },
		},
		send: async (url, body, headers) => {
			state.sends.push({ url, body, headers });
			state.clock += clockStep;
			return sendImpl ? sendImpl(url, body, headers) : { status: 200, snippet: "ok" };
		},
		audit: { record: async (entry) => state.audit.push(entry) },
		log: { info() {}, warn() {}, error() {} },
		clock: () => state.clock,
	};
	return { state, dispatcher: createDispatcher(deps), deps };
}

const subscription = (overrides = {}) => ({ _id: "s1", projectId: "p1", name: "Hook", url: "http://127.0.0.1:9/hook", secret: "sec", enabled: true, consecutiveFailures: 0, createdBy: "marcus", ...overrides });
const delivery = (overrides = {}) => ({ _id: "d1", subscriptionId: "s1", projectId: "p1", eventId: "e1", event: "flag.archived", payload: { id: "e1" }, status: "pending", attempts: [], budgetFrom: 0, nextAttemptAt: NOW, claimedAt: null, ...overrides });
const failed = (n) => Array.from({ length: n }, () => ({ at: NOW, outcome: "failed", durationMs: 1 }));

describe("dispatchDue", () => {
	test("delivers with signed headers, records real duration, resets the failure counter", async () => {
		const h = harness({ deliveries: [delivery()], subscriptions: [subscription({ consecutiveFailures: 2 })] });
		expect(await h.dispatcher.dispatchDue(NOW)).toEqual({ sent: 1, delivered: 1, failed: 0 });
		const d = h.state.deliveries[0];
		expect(d.status).toBe("delivered");
		expect(d.attempts[0]).toMatchObject({ outcome: "delivered", responseStatus: 200, durationMs: 12 });
		expect(h.state.subscriptions[0].consecutiveFailures).toBe(0);
		const { headers, body } = h.state.sends[0];
		expect(headers["X-Rheostat-Delivery"]).toBe("d1");
		expect(verify("sec", body, headers["X-Rheostat-Signature"], { nowSeconds: Math.floor(NOW.getTime() / 1000) })).toEqual({ valid: true });
	});
	test("a failure schedules the next attempt from the backoff table", async () => {
		const h = harness({ deliveries: [delivery()], subscriptions: [subscription()], sendImpl: async () => ({ status: 503, snippet: "down" }) });
		await h.dispatcher.dispatchDue(NOW);
		const d = h.state.deliveries[0];
		expect(d.status).toBe("pending");
		expect(d.attempts[0]).toMatchObject({ outcome: "failed", responseStatus: 503, responseSnippet: "down" });
		expect(d.nextAttemptAt).toEqual(at(BACKOFF_MS[1]));
		await h.dispatcher.dispatchDue(at(BACKOFF_MS[1] - 1000));
		expect(d.attempts).toHaveLength(1);
		await h.dispatcher.dispatchDue(at(BACKOFF_MS[1]));
		expect(d.attempts).toHaveLength(2);
		expect(d.nextAttemptAt).toEqual(at(BACKOFF_MS[1] + BACKOFF_MS[2]));
	});
	test("timeouts and connection errors record their elapsed duration", async () => {
		const h = harness({ deliveries: [delivery()], subscriptions: [subscription()], clockStep: 5000, sendImpl: async () => { throw Object.assign(new Error("The operation timed out"), { name: "TimeoutError" }); } });
		await h.dispatcher.dispatchDue(NOW);
		expect(h.state.deliveries[0].attempts[0]).toMatchObject({ outcome: "failed", error: "timeout", durationMs: 5000 });
	});
	test("the fifth failure dead-letters, audits once, increments the counter", async () => {
		const h = harness({ deliveries: [delivery({ attempts: failed(4) })], subscriptions: [subscription({ consecutiveFailures: 1 })], sendImpl: async () => { throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }); } });
		await h.dispatcher.dispatchDue(NOW);
		expect(h.state.deliveries[0].status).toBe("dead");
		expect(h.state.deliveries[0].attempts[4].error).toContain("ECONNREFUSED");
		expect(h.state.subscriptions[0].consecutiveFailures).toBe(2);
		expect(h.state.audit.map((entry) => entry.action)).toEqual(["webhook.deliveryDead"]);
	});
	test("redelivery budget: attempts after budgetFrom count, history before it does not", async () => {
		const h = harness({ deliveries: [delivery({ attempts: failed(5), budgetFrom: 5 })], subscriptions: [subscription()], sendImpl: async () => ({ status: 500, snippet: "" }) });
		await h.dispatcher.dispatchDue(NOW);
		const d = h.state.deliveries[0];
		expect(d.status).toBe("pending");
		expect(d.attempts).toHaveLength(6);
		expect(d.nextAttemptAt).toEqual(at(BACKOFF_MS[1]));
	});
	test("the breaker trips at five consecutive dead deliveries, holds pending ones, and never claims held rows", async () => {
		const h = harness({
			deliveries: [delivery({ attempts: failed(4) }), delivery({ _id: "d2", eventId: "e2", nextAttemptAt: at(1000) }), ...Array.from({ length: 30 }, (_, i) => delivery({ _id: `h${i}`, eventId: `h${i}`, status: "held" }))],
			subscriptions: [subscription({ consecutiveFailures: 4 }), subscription({ _id: "s2" })],
			sendImpl: async (url) => (url.endsWith("/ok") ? { status: 200, snippet: "" } : { status: 500, snippet: "" }),
		});
		h.state.subscriptions[1].url = "http://127.0.0.1:9/ok";
		h.state.deliveries.push(delivery({ _id: "d3", eventId: "e3", subscriptionId: "s2", nextAttemptAt: at(1000) }));
		await h.dispatcher.dispatchDue(NOW);
		expect(h.state.subscriptions[0]).toMatchObject({ enabled: false, disabledReason: "AUTO_FAILURES" });
		expect(h.state.audit.map((entry) => entry.action)).toEqual(["webhook.deliveryDead", "webhook.autoDisabled"]);
		expect(h.state.deliveries[1].status).toBe("held");
		const result = await h.dispatcher.dispatchDue(at(2000));
		expect(result).toEqual({ sent: 1, delivered: 1, failed: 0 });
		expect(h.state.deliveries.find((d) => d._id === "d3").status).toBe("delivered");
		expect(h.state.sends).toHaveLength(2);
	});
	test("a large pending backlog for a disabled subscription cannot starve an enabled one", async () => {
		const backlog = Array.from({ length: 500 }, (_, i) => delivery({ _id: `x${i}`, eventId: `x${i}`, subscriptionId: "sDisabled", nextAttemptAt: at(-1000 - i) }));
		const h = harness({ deliveries: [...backlog, delivery({ _id: "live", eventId: "live", subscriptionId: "sLive" })], subscriptions: [subscription({ _id: "sDisabled", enabled: false, disabledReason: "MANUAL" }), subscription({ _id: "sLive" })] });
		const result = await h.dispatcher.dispatchDue(NOW);
		expect(result).toEqual({ sent: 1, delivered: 1, failed: 0 });
		expect(h.state.deliveries.find((d) => d._id === "live").status).toBe("delivered");
		expect(h.state.sends).toHaveLength(1);
	});
	test("a row claimed for a subscription disabled after the exclusion set was read moves its whole backlog to held in one claim", async () => {
		const h = harness({ deliveries: [delivery(), delivery({ _id: "d2", eventId: "e2" }), delivery({ _id: "live", eventId: "live", subscriptionId: "s2" })], subscriptions: [subscription(), subscription({ _id: "s2" })] });
		const original = h.deps.subscriptions.findDisabledIds;
		h.deps.subscriptions.findDisabledIds = async () => { const ids = await original(); h.state.subscriptions[0].enabled = false; return ids; }; // disabled between exclusion read and claim
		const result = await h.dispatcher.dispatchDue(NOW);
		expect(h.state.deliveries.filter((d) => d.subscriptionId === "s1").map((d) => d.status)).toEqual(["held", "held"]);
		expect(result).toEqual({ sent: 1, delivered: 1, failed: 0 });
		expect(h.state.sends).toHaveLength(1);
	});
	test("automated audit entries use the system actor, not the subscription creator", async () => {
		const h = harness({ deliveries: [delivery({ attempts: failed(4) })], subscriptions: [subscription()], sendImpl: async () => ({ status: 500, snippet: "" }) });
		await h.dispatcher.dispatchDue(NOW);
		expect(String(h.state.audit[0].actor._id)).toBe("000000000000000000000001");
		expect(h.state.audit[0].actorKind).toBe("system");
		expect(h.state.audit[0].metadata.subscriptionCreatedBy).toBe("marcus");
	});
	test("a stale delivering claim is released and sent; a fresh one is left alone", async () => {
		const h = harness({ deliveries: [delivery({ status: "delivering", claimedAt: at(-61000) }), delivery({ _id: "d2", eventId: "e2", status: "delivering", claimedAt: at(-1000) })], subscriptions: [subscription()] });
		await h.dispatcher.dispatchDue(NOW);
		expect(h.state.deliveries[0].status).toBe("delivered");
		expect(h.state.deliveries[1].status).toBe("delivering");
	});
	test("two concurrent passes send a delivery once (fake-level claim semantics)", async () => {
		const h = harness({ deliveries: [delivery()], subscriptions: [subscription()] });
		await Promise.all([h.dispatcher.dispatchDue(NOW), h.dispatcher.dispatchDue(NOW)]);
		expect(h.state.sends).toHaveLength(1);
	});
	test("dispatchOne sends exactly the named delivery", async () => {
		const h = harness({ deliveries: [delivery(), delivery({ _id: "d2", eventId: "e2" })], subscriptions: [subscription()] });
		expect(await h.dispatcher.dispatchOne("d2", NOW)).toBe("delivered");
		expect(h.state.deliveries[1].status).toBe("delivered");
		expect(h.state.deliveries[0].status).toBe("pending");
		expect(await h.dispatcher.dispatchOne("missing", NOW)).toBe("missing");
	});
	test("headersFor signs with the subscription secret", () => {
		const headers = headersFor(subscription(), delivery(), '{"a":1}', 1700000000);
		expect(headers["Content-Type"]).toBe("application/json");
		expect(headers["X-Rheostat-Subscription"]).toBe("s1");
		expect(verify("sec", '{"a":1}', headers["X-Rheostat-Signature"], { nowSeconds: 1700000000 })).toEqual({ valid: true });
	});
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement `dispatch.js`**

```js
import { SYSTEM_ACTOR } from "../../shared/auth/system-actor.js";
import { sign } from "./signature.js";

export const BACKOFF_MS = [0, 30000, 120000, 300000, 900000];
export const MAX_ATTEMPTS = BACKOFF_MS.length;
export const BREAKER_THRESHOLD = 5;

export const headersFor = (subscription, delivery, body, timestampSeconds) => ({
	"Content-Type": "application/json",
	"User-Agent": "Rheostat-Webhooks/1",
	"X-Rheostat-Event": delivery.event,
	"X-Rheostat-Delivery": String(delivery._id),
	"X-Rheostat-Subscription": String(subscription._id),
	"X-Rheostat-Signature": sign(subscription.secret, body, timestampSeconds),
});

const describeFailure = (error) => (error?.name === "TimeoutError" ? "timeout" : String(error?.message || error).slice(0, 300));

// The delivery worker (spec §9.5). Claim → send → record. Every branch is idempotent so the 5 s ticker,
// the post-enqueue kick, and dispatchOne can overlap. Only `pending` rows are ever claimed; `held` rows belong
// to disabled subscriptions and cost nothing here.
export function createDispatcher({ deliveries, subscriptions, send, audit, log, clock = () => performance.now(), staleClaimMs = 60000, maxPerPass = 20 }) {
	// Automated entries are attributed to the system actor; the creator is kept as metadata for context only.
	const auditFor = (subscription, delivery, action, summary, extra = {}) =>
		audit.record({
			actor: SYSTEM_ACTOR,
			actorKind: "system",
			action,
			entityType: "webhook",
			entityId: subscription._id,
			entityLabel: subscription.name || subscription.url,
			projectId: subscription.projectId,
			summary,
			metadata: { deliveryId: String(delivery._id), event: delivery.event, subscriptionCreatedBy: String(subscription.createdBy), ...extra },
		});

	async function attempt(delivery, now) {
		const subscription = await subscriptions.findById(delivery.subscriptionId);
		if (!subscription) {
			await deliveries.finish(delivery._id, { status: "dead", claimedAt: null });
			return "failed";
		}
		if (!subscription.enabled) {
			// Disabled between the exclusion read and the claim: park this row and the subscription's whole backlog at once.
			await deliveries.finish(delivery._id, { status: "held", claimedAt: null });
			await deliveries.holdPending(subscription._id);
			return "held";
		}
		const body = JSON.stringify(delivery.payload);
		const headers = headersFor(subscription, delivery, body, Math.floor(now.getTime() / 1000));
		const started = clock();
		let outcome;
		try {
			const response = await send(subscription.url, body, headers);
			outcome = {
				at: now,
				outcome: response.status >= 200 && response.status < 300 ? "delivered" : "failed",
				durationMs: Math.round(clock() - started),
				responseStatus: response.status,
				responseSnippet: (response.snippet || "").slice(0, 500),
			};
		} catch (error) {
			outcome = { at: now, outcome: "failed", durationMs: Math.round(clock() - started), error: describeFailure(error) };
		}
		const attempts = [...delivery.attempts, outcome];
		if (outcome.outcome === "delivered") {
			await deliveries.finish(delivery._id, { status: "delivered", attempts, deliveredAt: now, claimedAt: null });
			await subscriptions.recordOutcome(subscription._id, "delivered", now);
			return "delivered";
		}
		const budgetUsed = attempts.length - (delivery.budgetFrom || 0);
		if (budgetUsed < MAX_ATTEMPTS) {
			await deliveries.finish(delivery._id, { status: "pending", attempts, nextAttemptAt: new Date(now.getTime() + BACKOFF_MS[budgetUsed]), claimedAt: null });
			return "failed";
		}
		await deliveries.finish(delivery._id, { status: "dead", attempts, claimedAt: null });
		const updated = await subscriptions.recordOutcome(subscription._id, "dead", now);
		await auditFor(subscription, delivery, "webhook.deliveryDead", `Delivery of ${delivery.event} to ${subscription.name || subscription.url} failed ${MAX_ATTEMPTS} times and was dead-lettered.`, {
			attempts: attempts.length,
			lastError: outcome.error || `HTTP ${outcome.responseStatus}`,
		});
		if (updated.consecutiveFailures >= BREAKER_THRESHOLD && (await subscriptions.disableAuto(subscription._id))) {
			await deliveries.holdPending(subscription._id);
			await auditFor(subscription, delivery, "webhook.autoDisabled", `${subscription.name || subscription.url} was disabled after ${BREAKER_THRESHOLD} consecutive dead-lettered deliveries.`);
			log.warn("webhook.autoDisabled", { subscriptionId: String(subscription._id) });
		}
		return "failed";
	}

	return {
		async dispatchDue(now = new Date()) {
			await deliveries.releaseStale(new Date(now.getTime() - staleClaimMs));
			const excluded = await subscriptions.findDisabledIds();
			const result = { sent: 0, delivered: 0, failed: 0 };
			for (let index = 0; index < maxPerPass; index += 1) {
				const delivery = await deliveries.claimNext(now, excluded);
				if (!delivery) break;
				const outcome = await attempt(delivery, now);
				if (outcome === "held") continue;
				result.sent += 1;
				if (outcome === "delivered") result.delivered += 1;
				else result.failed += 1;
			}
			return result;
		},
		async dispatchOne(id, now = new Date()) {
			const delivery = await deliveries.claimById(id, now);
			if (!delivery) return "missing";
			return attempt(delivery, now);
		},
	};
}
```

- [ ] **Step 4: Run** → 14 pass.

### Task W5A: Service (injectable) with authorization and scoping

**Files:** Create `backend/src/features/webhooks/webhook.service.js`, `backend/src/features/webhooks/webhook.service.test.js`.

**Interfaces:**
- Produces: `createWebhookService({ subscriptions, deliveries, receipts, projects, events, dispatcher, audit, apiOrigin, clock })` → `{ dispatchDue(now), stats(projectId), list(project, profile), create(project, input, profile), get(id, profile), update(id, patch, profile), remove(id, profile), deliveries(id, { status, cursor, limit }, profile), getDelivery(id, profile), redeliver(deliveryId, profile), test(id, profile), receipts(project, profile), clearReceipts(project, profile), sinkUrlFor(project) }`; default export `webhookService` built from the real modules; `WEBHOOK_NOT_FOUND`, `DELIVERY_NOT_FOUND`, `WEBHOOK_DISABLED` error codes.
- Consumes: `assertCan`, `can`; `createDispatcher`; `createEvents`; repositories from W3; `projects = { getById(id) }`; `audit = { record(entry) }`; `apiOrigin` from `getConfig().apiOrigin`.

- [ ] **Step 1: Test (fake repositories, real permission checks)**

```js
import { describe, expect, test } from "bun:test";
import { createWebhookService } from "./webhook.service.js";

const marcus = { _id: "marcus", name: "Marcus Chen", role: "releaseManager" };
const diego = { _id: "diego", name: "Diego Alvarez", role: "developer" };
const sam = { _id: "sam", name: "Sam Okafor", role: "viewer" };
const storefront = { _id: "p1", key: "storefront", name: "Storefront", webhookSink: { token: "tok1" } };
const mobile = { _id: "p2", key: "mobile", name: "Mobile app", webhookSink: { token: "tok2" } };

function harness() {
	const state = { subscriptions: [], deliveries: [], receipts: [], audit: [], sends: [] };
	let ids = 0;
	const nextId = (prefix) => `${prefix}${++ids}`;
	const subs = {
		findById: async (id) => state.subscriptions.find((s) => s._id === id) || null,
		findByProject: async (projectId) => state.subscriptions.filter((s) => s.projectId === projectId),
		findEnabledByProject: async (projectId) => state.subscriptions.filter((s) => s.projectId === projectId && s.enabled),
		findDisabledIds: async () => state.subscriptions.filter((s) => !s.enabled).map((s) => s._id),
		countByProject: async (projectId) => state.subscriptions.filter((s) => s.projectId === projectId).length,
		create: async (input) => { const doc = { _id: nextId("s"), enabled: true, consecutiveFailures: 0, disabledReason: null, ...input }; state.subscriptions.push(doc); return { ...doc }; },
		update: async (id, patch) => Object.assign(state.subscriptions.find((s) => s._id === id), patch),
		remove: async (id) => { state.subscriptions = state.subscriptions.filter((s) => s._id !== id); },
		recordOutcome: async (id, outcome, at) => { const s = state.subscriptions.find((x) => x._id === id); Object.assign(s, outcome === "delivered" ? { consecutiveFailures: 0, lastDeliveryStatus: "delivered", lastDeliveryAt: at } : { consecutiveFailures: s.consecutiveFailures + 1, lastDeliveryStatus: "dead", lastDeliveryAt: at }); return { ...s }; },
		disableAuto: async (id) => { const s = state.subscriptions.find((x) => x._id === id); if (!s.enabled) return false; Object.assign(s, { enabled: false, disabledReason: "AUTO_FAILURES" }); return true; },
	};
	const dels = {
		findById: async (id) => state.deliveries.find((d) => d._id === id) || null,
		insertMany: async (docs) => { const inserted = docs.map((doc) => ({ ...doc, _id: nextId("d"), createdAt: new Date() })); state.deliveries.push(...inserted); return inserted; },
		claimNext: async (now, exclude = []) => { const d = state.deliveries.find((x) => x.status === "pending" && x.nextAttemptAt <= now && !exclude.includes(x.subscriptionId)); if (!d) return null; Object.assign(d, { status: "delivering", claimedAt: now }); return { ...d }; },
		claimById: async (id, now) => { const d = state.deliveries.find((x) => x._id === id); if (!d || d.status !== "pending") return null; Object.assign(d, { status: "delivering", claimedAt: now }); return { ...d }; },
		releaseStale: async () => {},
		finish: async (id, patch) => Object.assign(state.deliveries.find((d) => d._id === id), patch),
		requeue: async (id, now, budgetFrom) => Object.assign(state.deliveries.find((d) => d._id === id), { status: "pending", nextAttemptAt: now, claimedAt: null, budgetFrom }),
		holdPending: async (sid) => { for (const d of state.deliveries) if (d.subscriptionId === sid && d.status === "pending") d.status = "held"; },
		releaseHeld: async (sid, now) => { for (const d of state.deliveries) if (d.subscriptionId === sid && d.status === "held") Object.assign(d, { status: "pending", nextAttemptAt: now }); },
		findPage: async (sid, { status, limit }) => state.deliveries.filter((d) => d.subscriptionId === sid && (!status || d.status === status)).slice(0, limit + 1),
		countByStatus: async (filter) => { const rows = state.deliveries.filter((d) => Object.entries(filter).every(([k, v]) => d[k] === v)); const by = {}; for (const r of rows) by[r.status] = (by[r.status] || 0) + 1; return Object.entries(by).map(([_id, count]) => ({ _id, count })); },
		removeForSubscription: async (sid) => { state.deliveries = state.deliveries.filter((d) => d.subscriptionId !== sid); },
	};
	const receipts = { findRecent: async (projectId) => state.receipts.filter((r) => r.projectId === projectId), clear: async (projectId) => { state.receipts = state.receipts.filter((r) => r.projectId !== projectId); } };
	const service = createWebhookService({
		subscriptions: subs,
		deliveries: dels,
		receipts,
		projects: { getById: async (id) => [storefront, mobile].find((p) => p._id === id) },
		audit: { record: async (entry) => state.audit.push(entry) },
		send: async (url, body, headers) => { state.sends.push({ url, body, headers }); return url.includes("/dead") ? { status: 503, snippet: "down" } : { status: 204, snippet: "" }; },
		apiOrigin: "http://localhost:8000",
	});
	return { state, service };
}
const input = (overrides = {}) => ({ name: "Notifier", url: "http://localhost:8000/api/v1/webhook-sink/tok1", events: ["flag.archived"], environments: [], ...overrides });

describe("webhookService", () => {
	test("create returns the secret once; get hides it; developers cannot create", async () => {
		const { service } = harness();
		const created = await service.create(storefront, input(), marcus);
		expect(created.secret).toMatch(/^[0-9a-f]{64}$/);
		const fetched = await service.get(created._id, sam);
		expect(fetched.secret).toBeUndefined();
		expect(fetched.secretHint).toBe(`…${created.secret.slice(-4)}`);
		expect(fetched.permissions.canManage).toBe(false);
		await expect(service.create(storefront, input(), diego)).rejects.toMatchObject({ statusCode: 403 });
	});
	test("list is scoped to the project and reports the sink url and counts", async () => {
		const { service } = harness();
		await service.create(storefront, input(), marcus);
		await service.create(mobile, input({ url: "http://localhost:8000/api/v1/webhook-sink/tok2" }), marcus);
		const page = await service.list(storefront, sam);
		expect(page.items).toHaveLength(1);
		expect(page.sinkUrl).toBe("http://localhost:8000/api/v1/webhook-sink/tok1");
		expect(page.items[0].counts).toEqual({ delivered: 0, dead: 0, pending: 0, held: 0 });
	});
	test("test() returns exactly the delivery it created, even when others are created concurrently", async () => {
		const { service, state } = harness();
		const a = await service.create(storefront, input({ name: "A" }), marcus);
		const b = await service.create(storefront, input({ name: "B", url: "http://127.0.0.1:9/dead" }), marcus);
		const [ra, rb] = await Promise.all([service.test(a._id, marcus), service.test(b._id, marcus)]);
		expect(ra.subscriptionId).toBe(a._id);
		expect(rb.subscriptionId).toBe(b._id);
		expect(ra.status).toBe("delivered");
		expect(rb.status).toBe("pending");
		expect(rb.attempts[0].responseStatus).toBe(503);
		expect(state.deliveries).toHaveLength(2);
	});
	test("test() on a disabled subscription → 422 WEBHOOK_DISABLED; enqueue failure propagates", async () => {
		const { service, state } = harness();
		const a = await service.create(storefront, input(), marcus);
		await service.update(a._id, { enabled: false }, marcus);
		await expect(service.test(a._id, marcus)).rejects.toMatchObject({ code: "WEBHOOK_DISABLED" });
		await service.update(a._id, { enabled: true }, marcus);
		const original = state; // simulate a failing insert
		const failing = createWebhookServiceWithFailingInsert(service, original);
		await expect(failing.test(a._id, marcus)).rejects.toThrow("db down");
	});
	test("rotation returns a new secret once and invalidates the old one for signing", async () => {
		const { service, state } = harness();
		const a = await service.create(storefront, input(), marcus);
		const rotated = await service.update(a._id, { rotateSecret: true }, marcus);
		expect(rotated.secret).not.toBe(a.secret);
		expect(state.subscriptions[0].secret).toBe(rotated.secret);
		expect((await service.get(a._id, marcus)).secret).toBeUndefined();
	});
	test("disable holds pending deliveries; enable releases them and resets the counter", async () => {
		const { service, state } = harness();
		const a = await service.create(storefront, input({ url: "http://127.0.0.1:9/dead" }), marcus);
		await service.test(a._id, marcus);
		expect(state.deliveries[0].status).toBe("pending");
		await service.update(a._id, { enabled: false }, marcus);
		expect(state.deliveries[0].status).toBe("held");
		state.subscriptions[0].consecutiveFailures = 4;
		const enabled = await service.update(a._id, { enabled: true }, marcus);
		expect(enabled.consecutiveFailures).toBe(0);
		expect(["pending", "delivering", "dead"].includes(state.deliveries[0].status)).toBe(true);
	});
	test("redeliver starts a fresh budget, preserves history, and returns that delivery", async () => {
		const { service, state } = harness();
		const a = await service.create(storefront, input({ url: "http://127.0.0.1:9/dead" }), marcus);
		const first = await service.test(a._id, marcus);
		Object.assign(state.deliveries[0], { status: "dead", attempts: Array(5).fill({ at: new Date(), outcome: "failed", durationMs: 1 }) });
		const redelivered = await service.redeliver(first._id, marcus);
		expect(redelivered._id).toBe(first._id);
		expect(redelivered.budgetFrom).toBe(5);
		expect(redelivered.attempts).toHaveLength(6);
		expect(redelivered.status).toBe("pending");
		await expect(service.redeliver(first._id, sam)).rejects.toMatchObject({ statusCode: 403 });
	});
	test("deliveries and getDelivery are scoped through the resource, never a client-supplied project", async () => {
		const { service, state } = harness();
		const a = await service.create(storefront, input(), marcus);
		const b = await service.create(mobile, input({ url: "http://localhost:8000/api/v1/webhook-sink/tok2" }), marcus);
		const da = await service.test(a._id, marcus);
		const db = await service.test(b._id, marcus);
		expect((await service.deliveries(a._id, { limit: 10 }, sam)).items.map((d) => d._id)).toEqual([da._id]);
		expect((await service.deliveries(b._id, { limit: 10 }, sam)).items.map((d) => d._id)).toEqual([db._id]);
		expect((await service.getDelivery(db._id, sam)).subscription._id).toBe(b._id);
		expect(state.deliveries).toHaveLength(2);
	});
	test("remove deletes the subscription and its deliveries; stats count dead deliveries per project", async () => {
		const { service, state } = harness();
		const a = await service.create(storefront, input({ url: "http://127.0.0.1:9/dead" }), marcus);
		await service.test(a._id, marcus);
		state.deliveries[0].status = "dead";
		expect(await service.stats("p1")).toEqual({ deadDeliveries: 1, subscriptions: 1 });
		expect(await service.stats("p2")).toEqual({ deadDeliveries: 0, subscriptions: 0 });
		await service.remove(a._id, marcus);
		expect(state.subscriptions).toHaveLength(0);
		expect(state.deliveries).toHaveLength(0);
		expect(state.audit.map((e) => e.action)).toContain("webhook.deleted");
	});
});

// Wraps a service's events with a failing insert to prove enqueue errors surface from test().
function createWebhookServiceWithFailingInsert(service, state) {
	return { test: (id, profile) => service.__withDeliveries({ ...service.__deps.deliveries, insertMany: async () => { throw new Error("db down"); } }).test(id, profile) };
}
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**

```js
import { randomBytes } from "node:crypto";
import { assertCan, can } from "../../shared/auth/permissions.js";
import { getConfig } from "../../shared/config/index.js";
import { AppError } from "../../shared/errors/app-error.js";
import { logger } from "../../shared/logging/logger.js";
import { auditService } from "../audit/audit.service.js";
import { projectService } from "../projects/project.service.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { createDispatcher } from "./dispatch.js";
import { createEvents, setDispatcher } from "./events.js";
import { deliveryRepository, receiptRepository, subscriptionRepository } from "./webhook.repository.js";

const NOT_FOUND = () => new AppError(404, "WEBHOOK_NOT_FOUND", "The requested webhook does not exist.");
const DELIVERY_NOT_FOUND = () => new AppError(404, "DELIVERY_NOT_FOUND", "The requested delivery does not exist.");
const newSecret = () => randomBytes(32).toString("hex");
const publicSubscription = ({ secret, ...rest }) => ({ ...rest, secretHint: `…${secret.slice(-4)}` });

// Real HTTP send. Any 2xx is success; the dispatcher measures duration and classifies errors.
export async function httpSend(url, body, headers) {
	const response = await fetch(url, { method: "POST", body, headers, signal: AbortSignal.timeout(5000), redirect: "manual" });
	const text = await response.text().catch(() => "");
	return { status: response.status, snippet: text.slice(0, 500) };
}

export function createWebhookService(deps) {
	const { subscriptions, deliveries, receipts, projects, audit, send = httpSend, apiOrigin, clock = () => performance.now(), log = logger } = deps;
	const dispatcher = createDispatcher({ deliveries, subscriptions, send, audit, log, clock });
	const events = createEvents({ subscriptions, deliveries, log, dispatchNow: () => dispatcher.dispatchDue(new Date()).catch((error) => log.warn("webhook.dispatch.failed", { error })) });
	const auditFor = (actor, action, subscription, summary, metadata = {}) =>
		audit.record({ actor, action, entityType: "webhook", entityId: subscription._id, entityLabel: subscription.name, projectId: subscription.projectId, summary, metadata });
	const canManage = (profile) => can(profile.role, "webhook:manage");
	const countsFor = async (filter) => {
		const rows = await deliveries.countByStatus(filter);
		const by = Object.fromEntries(rows.map((row) => [row._id, row.count]));
		return { delivered: by.delivered || 0, dead: by.dead || 0, pending: (by.pending || 0) + (by.delivering || 0), held: by.held || 0 };
	};
	async function load(id) {
		const subscription = await subscriptions.findById(id);
		if (!subscription) throw NOT_FOUND();
		return { subscription, project: await projects.getById(subscription.projectId) };
	}
	const decorateDelivery = async (delivery) => ({
		...delivery,
		subscription: await subscriptions.findById(delivery.subscriptionId).then((s) => (s ? publicSubscription(s) : null)),
		headers: { "X-Rheostat-Event": delivery.event, "X-Rheostat-Delivery": String(delivery._id), "X-Rheostat-Subscription": String(delivery.subscriptionId), "X-Rheostat-Signature": "t=<timestamp>,v1=<hmac-sha256>" },
	});

	const service = {
		__deps: deps,
		__withDeliveries: (override) => createWebhookService({ ...deps, deliveries: override }),
		dispatchDue: (now = new Date()) => dispatcher.dispatchDue(now),
		events,
		sinkUrlFor: (project) => `${apiOrigin}/api/v1/webhook-sink/${project.webhookSink.token}`,

		async stats(projectId) {
			const [counts, count] = await Promise.all([countsFor({ projectId }), subscriptions.countByProject(projectId)]);
			return { deadDeliveries: counts.dead, subscriptions: count };
		},

		async list(project, profile) {
			assertCan(profile, "webhook:read");
			const rows = await subscriptions.findByProject(project._id);
			const items = await Promise.all(rows.map(async (row) => ({ ...publicSubscription(row), counts: await countsFor({ subscriptionId: row._id }) })));
			return { items, sinkUrl: service.sinkUrlFor(project), totals: { dead: (await countsFor({ projectId: project._id })).dead }, permissions: { canManage: canManage(profile) } };
		},

		async create(project, input, profile) {
			assertCan(profile, "webhook:manage");
			const secret = newSecret();
			const created = await subscriptions.create({ ...input, projectId: project._id, secret, createdBy: profile._id });
			await auditFor(profile, "webhook.created", created, `${profile.name} added webhook "${created.name}" (${created.events.length} events).`, { url: created.url, events: created.events });
			return { ...publicSubscription(created), secret, permissions: { canManage: true } };
		},

		async get(id, profile) {
			assertCan(profile, "webhook:read");
			const { subscription } = await load(id);
			return { ...publicSubscription(subscription), permissions: { canManage: canManage(profile) } };
		},

		async update(id, { rotateSecret = false, ...patch }, profile) {
			assertCan(profile, "webhook:manage");
			const { subscription } = await load(id);
			const now = new Date();
			const fields = { ...patch };
			if (patch.enabled === true) Object.assign(fields, { disabledReason: null, consecutiveFailures: 0 });
			if (patch.enabled === false) fields.disabledReason = "MANUAL";
			let secret;
			if (rotateSecret) fields.secret = secret = newSecret();
			const updated = await subscriptions.update(id, fields);
			if (patch.enabled === false && subscription.enabled) await deliveries.holdPending(id);
			if (patch.enabled === true && !subscription.enabled) await deliveries.releaseHeld(id, now);
			const changed = Object.keys(fields).filter((key) => key !== "secret");
			await auditFor(profile, rotateSecret ? "webhook.secretRotated" : "webhook.updated", updated, rotateSecret ? `${profile.name} rotated the secret of webhook "${updated.name}".` : `${profile.name} updated webhook "${updated.name}" (${changed.join(", ")}).`, { fields: changed });
			if (patch.enabled === true) dispatcher.dispatchDue(now).catch((error) => log.warn("webhook.dispatch.failed", { error }));
			return { ...publicSubscription(updated), ...(secret ? { secret } : {}), permissions: { canManage: true } };
		},

		async remove(id, profile) {
			assertCan(profile, "webhook:manage");
			const { subscription } = await load(id);
			await deliveries.removeForSubscription(id);
			await subscriptions.remove(id);
			await auditFor(profile, "webhook.deleted", subscription, `${profile.name} deleted webhook "${subscription.name}".`);
		},

		async deliveries(id, { status, cursor = null, limit = 25 }, profile) {
			assertCan(profile, "webhook:read");
			await load(id);
			const decoded = cursor ? decodeCursor(cursor) : null;
			if (cursor && !decoded) throw new AppError(400, "VALIDATION_ERROR", "The cursor is not valid.");
			const rows = await deliveries.findPage(id, { status, cursor: decoded, limit });
			const page = rows.slice(0, limit).map(({ payload, ...rest }) => ({ ...rest, lastAttempt: rest.attempts.at(-1) || null }));
			return { items: page, nextCursor: rows.length > limit ? encodeCursor(page.at(-1)) : null };
		},

		async getDelivery(deliveryId, profile) {
			assertCan(profile, "webhook:read");
			const delivery = await deliveries.findById(deliveryId);
			if (!delivery) throw DELIVERY_NOT_FOUND();
			return decorateDelivery(delivery);
		},

		// Fresh retry budget, full history kept, immediate attempt, and the same row returned.
		async redeliver(deliveryId, profile) {
			assertCan(profile, "webhook:manage");
			const delivery = await deliveries.findById(deliveryId);
			if (!delivery) throw DELIVERY_NOT_FOUND();
			if (delivery.status === "delivering" || delivery.status === "held") throw new AppError(422, "INVALID_TRANSITION", `A ${delivery.status} delivery cannot be requeued.`);
			const now = new Date();
			await deliveries.requeue(deliveryId, now, delivery.attempts.length);
			const subscription = await subscriptions.findById(delivery.subscriptionId);
			await auditFor(profile, "webhook.redelivered", subscription, `${profile.name} requeued delivery of ${delivery.event} to "${subscription.name}".`, { deliveryId: String(deliveryId) });
			await dispatcher.dispatchOne(deliveryId, now);
			return decorateDelivery(await deliveries.findById(deliveryId));
		},

		// Enqueues one webhook.test delivery for this subscription only, dispatches that row, returns that row.
		async test(id, profile) {
			assertCan(profile, "webhook:manage");
			const { subscription, project } = await load(id);
			if (!subscription.enabled) throw new AppError(422, "WEBHOOK_DISABLED", "Enable the webhook before sending a test.");
			const eventId = `test:${subscription._id}:${Date.now()}:${randomBytes(4).toString("hex")}`;
			const [created] = await events.enqueue({ event: "webhook.test", eventId, project, data: { subscriptionId: String(subscription._id), requestedBy: String(profile._id) }, onlySubscriptionId: subscription._id });
			await dispatcher.dispatchOne(created._id, new Date());
			return decorateDelivery(await deliveries.findById(created._id));
		},

		async receipts(project, profile) {
			assertCan(profile, "webhook:read");
			return receipts.findRecent(project._id);
		},
		async clearReceipts(project, profile) {
			assertCan(profile, "webhook:manage");
			await receipts.clear(project._id);
		},
	};
	return service;
}

export const webhookService = createWebhookService({
	subscriptions: subscriptionRepository,
	deliveries: deliveryRepository,
	receipts: receiptRepository,
	projects: { getById: (id) => projectService.getById(id) },
	audit: { record: (entry) => auditService.record(entry) },
	apiOrigin: getConfig().apiOrigin,
});
setDispatcher(() => webhookService.dispatchDue(new Date()));
```

Note: `events.enqueue` in `test()` calls `dispatchNow` (a general pass) before `dispatchOne`; the general pass may already deliver the row, in which case `claimById` finds it not `pending` and `dispatchOne` returns `"missing"` — the returned row is still the one created, read by id. That is the exact-correlation guarantee. The `__deps`/`__withDeliveries` helpers exist for the enqueue-failure test only.

`getConfig()` at module load requires `initConfig()` to have run: `index.js` does; tests that import the default instance set env and call `initConfig()` first (Global Constraints).

- [ ] **Step 4: Run** → 9 pass.

### Task W5B: Controllers and routes with real HTTP tests

**Files:** Create `backend/src/features/webhooks/webhook.controller.js`, `backend/src/features/webhooks/webhook.routes.js`, `backend/src/features/webhooks/webhook.http.test.js`.

**Interfaces:**
- Produces: `createWebhookRouters(service) → { projectWebhookRouter, webhookRouter, deliveryRouter }`; default exports built from `webhookService`. Zod schemas `createSchema`, `updateSchema`, `deliveriesSchema`.

- [ ] **Step 1: Controller**

```js
import { z } from "zod";
import { keySchema, objectIdSchema } from "../../shared/utils/keys.js";
import { personService } from "../people/person.service.js";
import { ENVIRONMENT_KEYS } from "../projects/project.model.js";
import { projectService } from "../projects/project.service.js";
import { WEBHOOK_EVENTS } from "./events-catalogue.js";
import { DELIVERY_STATUSES } from "./webhook-delivery.model.js";

const urlSchema = z
	.string()
	.trim()
	.max(500)
	.refine((value) => {
		try {
			const url = new URL(value);
			return url.protocol === "http:" || url.protocol === "https:";
		} catch {
			return false;
		}
	}, "Enter an absolute http(s) URL.");
export const createSchema = z
	.object({ name: z.string().trim().min(1).max(80), url: urlSchema, events: z.array(z.enum(WEBHOOK_EVENTS)).min(1), environments: z.array(z.enum(ENVIRONMENT_KEYS)).default([]) })
	.strict();
export const updateSchema = createSchema
	.partial()
	.extend({ enabled: z.boolean().optional(), rotateSecret: z.boolean().optional() })
	.strict()
	.refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");
export const deliveriesSchema = z.object({ status: z.enum(DELIVERY_STATUSES).optional(), cursor: z.string().max(80).optional(), limit: z.coerce.number().int().min(1).max(100).default(25) });

const id = (request) => objectIdSchema.parse(request.params.id);

// Handlers are built from a service so HTTP tests can run against fakes. `people` decorates creators.
export function createWebhookHandlers(service, { projects = projectService, people = personService } = {}) {
	const wrap = (fn) => (request, response, next) => Promise.resolve(fn(request, response)).catch(next);
	return {
		list: wrap(async (request, response) => {
			const project = await projects.getByKey(request.params.projectKey);
			const page = await service.list(project, request.profile);
			response.json({ data: { ...page, items: await people.attachActors(page.items, "createdBy", "createdByPerson") } });
		}),
		create: wrap(async (request, response) => {
			const input = createSchema.parse(request.body);
			const project = await projects.getByKey(request.params.projectKey);
			response.status(201).json({ data: await service.create(project, input, request.profile) });
		}),
		get: wrap(async (request, response) => response.json({ data: await service.get(id(request), request.profile) })),
		update: wrap(async (request, response) => response.json({ data: await service.update(id(request), updateSchema.parse(request.body), request.profile) })),
		remove: wrap(async (request, response) => { await service.remove(id(request), request.profile); response.status(204).end(); }),
		deliveries: wrap(async (request, response) => response.json({ data: await service.deliveries(id(request), deliveriesSchema.parse(request.query), request.profile) })),
		test: wrap(async (request, response) => response.json({ data: await service.test(id(request), request.profile) })),
		getDelivery: wrap(async (request, response) => response.json({ data: await service.getDelivery(id(request), request.profile) })),
		redeliver: wrap(async (request, response) => response.json({ data: await service.redeliver(id(request), request.profile) })),
		receipts: wrap(async (request, response) => response.json({ data: await service.receipts(await projects.getByKey(request.params.projectKey), request.profile) })),
		clearReceipts: wrap(async (request, response) => { await service.clearReceipts(await projects.getByKey(request.params.projectKey), request.profile); response.status(204).end(); }),
	};
}
```

- [ ] **Step 2: Routes**

```js
import { Router } from "express";
import { createWebhookHandlers } from "./webhook.controller.js";
import { webhookService } from "./webhook.service.js";

export function createWebhookRouters(service, options) {
	const h = createWebhookHandlers(service, options);
	const projectWebhookRouter = Router({ mergeParams: true });
	projectWebhookRouter.get("/", h.list);
	projectWebhookRouter.post("/", h.create);
	projectWebhookRouter.get("/sink/receipts", h.receipts);
	projectWebhookRouter.delete("/sink/receipts", h.clearReceipts);
	const webhookRouter = Router();
	webhookRouter.get("/:id", h.get);
	webhookRouter.patch("/:id", h.update);
	webhookRouter.delete("/:id", h.remove);
	webhookRouter.get("/:id/deliveries", h.deliveries);
	webhookRouter.post("/:id/test", h.test);
	const deliveryRouter = Router();
	deliveryRouter.get("/:id", h.getDelivery);
	deliveryRouter.post("/:id/redeliver", h.redeliver);
	return { projectWebhookRouter, webhookRouter, deliveryRouter };
}

export const { projectWebhookRouter, webhookRouter, deliveryRouter } = createWebhookRouters(webhookService);
```

- [ ] **Step 3: HTTP test (real Express, fake repositories, stub auth)**

`webhook.http.test.js` reuses the W5A harness (extract it to `backend/src/features/webhooks/test-harness.js` exporting `harness`, `storefront`, `mobile`, `marcus`, `diego`, `sam`, `input`) and mounts the routers:

```js
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import express from "express";
import mongoose from "mongoose";
import { errorHandler, notFoundHandler } from "../../shared/middleware/error-handler.js";
import { requestContext } from "../../shared/middleware/request-context.js";
import { harness, input, marcus, mobile, sam, storefront } from "./test-harness.js";
import { createWebhookRouters } from "./webhook.routes.js";

const oid = () => new mongoose.Types.ObjectId().toString();
let server;
let base;
let h;
const profiles = { marcus, sam };
beforeAll(async () => {
	h = harness({ objectIds: true }); // harness option: ids are real ObjectId strings so objectIdSchema accepts them
	const app = express();
	app.use("/api", requestContext);
	app.use(express.json({ limit: "200kb" }));
	app.use((request, response, next) => { request.profile = profiles[request.get("x-test-profile") || "marcus"]; request.profileId = request.profile._id; next(); });
	const routers = createWebhookRouters(h.service, { projects: { getByKey: async (key) => [storefront, mobile].find((p) => p.key === key) }, people: { attachActors: async (items) => items } });
	app.use("/api/v1/projects/:projectKey/webhooks", routers.projectWebhookRouter);
	app.use("/api/v1/webhooks", routers.webhookRouter);
	app.use("/api/v1/deliveries", routers.deliveryRouter);
	app.use(notFoundHandler);
	app.use(errorHandler);
	server = app.listen(0, "127.0.0.1");
	await new Promise((resolve) => server.once("listening", resolve));
	base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
afterAll(() => server.close());
const call = (method, path, { body, profile = "marcus" } = {}) =>
	fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", "x-test-profile": profile }, body: body === undefined ? undefined : JSON.stringify(body) });

describe("webhook HTTP API", () => {
	let created;
	test("POST create → 201 with secret; validation → 400 envelope; viewer → 403", async () => {
		const response = await call("POST", "/projects/storefront/webhooks", { body: input() });
		expect(response.status).toBe(201);
		created = (await response.json()).data;
		expect(created.secret).toMatch(/^[0-9a-f]{64}$/);
		const bad = await call("POST", "/projects/storefront/webhooks", { body: input({ url: "ftp://x", events: [] }) });
		expect(bad.status).toBe(400);
		const envelope = await bad.json();
		expect(envelope.error.code).toBe("VALIDATION_ERROR");
		expect(envelope.error.details.fieldErrors.url[0]).toBe("Enter an absolute http(s) URL.");
		expect(envelope.error.requestId).toBeTruthy();
		expect((await call("POST", "/projects/storefront/webhooks", { body: input(), profile: "sam" })).status).toBe(403);
	});
	test("GET hides the secret; list is project-scoped; unknown id → 404; malformed id → 400", async () => {
		const detail = (await (await call("GET", `/webhooks/${created._id}`, { profile: "sam" })).json()).data;
		expect(detail.secret).toBeUndefined();
		expect(detail.secretHint).toHaveLength(5);
		const other = (await (await call("POST", "/projects/mobile/webhooks", { body: input({ url: "http://localhost:8000/api/v1/webhook-sink/tok2" }) })).json()).data;
		const list = (await (await call("GET", "/projects/storefront/webhooks")).json()).data;
		expect(list.items.map((item) => item._id)).toEqual([created._id]);
		expect(list.items[0]._id).not.toBe(other._id);
		expect((await call("GET", `/webhooks/${oid()}`)).status).toBe(404);
		expect((await call("GET", "/webhooks/not-an-id")).status).toBe(400);
	});
	test("PATCH rotates once; unknown fields → 400; DELETE → 204 then 404", async () => {
		const rotated = (await (await call("PATCH", `/webhooks/${created._id}`, { body: { rotateSecret: true } })).json()).data;
		expect(rotated.secret).toMatch(/^[0-9a-f]{64}$/);
		expect(rotated.secret).not.toBe(created.secret);
		expect((await call("PATCH", `/webhooks/${created._id}`, { body: { nope: 1 } })).status).toBe(400);
		expect((await call("PATCH", `/webhooks/${created._id}`, { body: {} })).status).toBe(400);
		const victim = (await (await call("POST", "/projects/storefront/webhooks", { body: input({ name: "Victim" }) })).json()).data;
		expect((await call("DELETE", `/webhooks/${victim._id}`)).status).toBe(204);
		expect((await call("GET", `/webhooks/${victim._id}`)).status).toBe(404);
	});
	test("POST test returns the created delivery; GET deliveries paginates with a cursor; redeliver keeps history", async () => {
		const first = (await (await call("POST", `/webhooks/${created._id}/test`)).json()).data;
		expect(first.subscriptionId).toBe(created._id);
		expect(first.status).toBe("delivered");
		const second = (await (await call("POST", `/webhooks/${created._id}/test`)).json()).data;
		expect(second._id).not.toBe(first._id);
		const page1 = (await (await call("GET", `/webhooks/${created._id}/deliveries?limit=1`)).json()).data;
		expect(page1.items).toHaveLength(1);
		expect(page1.nextCursor).toBeTruthy();
		const page2 = (await (await call("GET", `/webhooks/${created._id}/deliveries?limit=1&cursor=${encodeURIComponent(page1.nextCursor)}`)).json()).data;
		expect(page2.items[0]._id).not.toBe(page1.items[0]._id);
		expect((await call("GET", `/webhooks/${created._id}/deliveries?cursor=garbage`)).status).toBe(400);
		const redelivered = (await (await call("POST", `/deliveries/${first._id}/redeliver`)).json()).data;
		expect(redelivered._id).toBe(first._id);
		expect(redelivered.attempts).toHaveLength(2);
		expect(redelivered.budgetFrom).toBe(1);
		expect((await call("POST", `/deliveries/${first._id}/redeliver`, { profile: "sam" })).status).toBe(403);
		expect((await call("GET", `/deliveries/${oid()}`)).status).toBe(404);
	});
	test("receipts are project-scoped and clearable by managers only", async () => {
		expect((await call("GET", "/projects/storefront/webhooks/sink/receipts", { profile: "sam" })).status).toBe(200);
		expect((await call("DELETE", "/projects/storefront/webhooks/sink/receipts", { profile: "sam" })).status).toBe(403);
		expect((await call("DELETE", "/projects/storefront/webhooks/sink/receipts")).status).toBe(204);
	});
});
```

The harness gets an `objectIds: true` option: `nextId` returns `new mongoose.Types.ObjectId().toString()` and the fakes compare ids as strings.

- [ ] **Step 4: Run** → 5 pass. **Step 5:** `bun test` → all pass.

### Task W5C: Sink router with raw-body integration tests

**Files:** Create `backend/src/features/webhooks/sink.controller.js`, `backend/src/features/webhooks/sink.http.test.js`; modify `backend/src/app.js`.

**Interfaces:** `createSinkRouter({ projects: { findBySinkToken }, subscriptions: { findById }, receipts: { insert, exists }, now = () => Date.now() })`; default `sinkRouter`. Responses per spec §9.6.

- [ ] **Step 1: Implement**

```js
import { randomUUID } from "node:crypto";
import express, { Router } from "express";
import mongoose from "mongoose";
import { AppError } from "../../shared/errors/app-error.js";
import { createRateLimiter } from "../../shared/middleware/rate-limit.js";
import { projectRepository } from "../projects/project.repository.js";
import { verify } from "./signature.js";
import { receiptRepository, subscriptionRepository } from "./webhook.repository.js";

const INVALID = (reason) => new AppError(401, "SIGNATURE_INVALID", "The webhook signature could not be verified.", { reason });

// The built-in receiver. Mounted ahead of the JSON parser so it verifies the HMAC over the exact bytes sent.
export function createSinkRouter({ projects, subscriptions, receipts, now = () => Date.now() }) {
	const limiter = createRateLimiter({ name: "sink", windowMs: 60000, max: 120, keyFor: (request) => request.params.token });
	const router = Router();
	router.post("/:token", limiter, express.raw({ type: "*/*", limit: "16kb" }), async (request, response, next) => {
		try {
			const project = await projects.findBySinkToken(request.params.token);
			if (!project) throw new AppError(404, "SINK_NOT_FOUND", "Unknown receiver token.");
			const body = Buffer.isBuffer(request.body) ? request.body.toString("utf8") : "";
			const deliveryId = request.get("x-rheostat-delivery") || "";
			const subscriptionId = request.get("x-rheostat-subscription") || "";
			const found = mongoose.isValidObjectId(subscriptionId) ? await subscriptions.findById(subscriptionId) : null;
			// Binding invariant: the subscription must belong to the project that owns this sink token.
			const subscription = found && String(found.projectId) === String(project._id) ? found : null;
			const check = subscription ? verify(subscription.secret, body, request.get("x-rheostat-signature"), { nowSeconds: Math.floor(now() / 1000) }) : { valid: false, error: "unknown subscription" };
			const receivedAt = new Date(now());
			// Atomic dedupe: valid deliveries key on the delivery id; invalid attempts are always recorded individually.
			const receipt = await receipts.record({
				projectId: project._id,
				subscriptionId: subscription?._id || null,
				dedupeKey: check.valid && deliveryId ? deliveryId : `invalid:${randomUUID()}`,
				deliveryId: deliveryId || "(none)",
				event: request.get("x-rheostat-event") || "(none)",
				lastReceivedAt: receivedAt,
				headers: Object.fromEntries(Object.entries(request.headers).filter(([name]) => name.startsWith("x-rheostat-"))),
				body,
				signatureValid: check.valid,
				signatureError: check.error || "",
			});
			if (!check.valid) throw INVALID(check.error);
			response.setHeader("X-Rheostat-Received-Count", receipt.receivedCount);
			response.status(204).end();
		} catch (error) {
			next(error);
		}
	});
	return router;
}

export const sinkRouter = createSinkRouter({ projects: projectRepository, subscriptions: subscriptionRepository, receipts: receiptRepository });
```

`app.js`: `import { sinkRouter } from "./features/webhooks/sink.controller.js";` and mount `app.use("/api/v1/webhook-sink", sinkRouter);` on the line marked in Task 6.5 step 9 — after `requestContext`, **before** `express.json`.

- [ ] **Step 2: HTTP test**

```js
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import express from "express";
import mongoose from "mongoose";
import { errorHandler, notFoundHandler } from "../../shared/middleware/error-handler.js";
import { requestContext } from "../../shared/middleware/request-context.js";
import { sign } from "./signature.js";
import { createSinkRouter } from "./sink.controller.js";

const subscriptionId = new mongoose.Types.ObjectId().toString();
const otherProjectSubscriptionId = new mongoose.Types.ObjectId().toString();
const state = { receipts: [] };
// Fake receipt store with the same atomicity as the unique-index upsert: one document per (projectId, dedupeKey).
const record = async (doc) => {
	const existing = state.receipts.find((r) => r.projectId === doc.projectId && r.dedupeKey === doc.dedupeKey);
	if (existing) { existing.receivedCount += 1; existing.lastReceivedAt = doc.lastReceivedAt; return existing; }
	const created = { ...doc, firstReceivedAt: doc.lastReceivedAt, receivedCount: 1 };
	state.receipts.push(created);
	return created;
};
let server;
let base;
let clock = 1700000000000;
beforeAll(async () => {
	const app = express();
	app.use("/api", requestContext);
	app.use("/api/v1/webhook-sink", createSinkRouter({
		projects: { findBySinkToken: async (token) => ({ tok1: { _id: "p1" }, tok2: { _id: "p2" } })[token] || null },
		subscriptions: { findById: async (id) => ({ [subscriptionId]: { _id: subscriptionId, projectId: "p1", secret: "sec" }, [otherProjectSubscriptionId]: { _id: otherProjectSubscriptionId, projectId: "p2", secret: "sec2" } })[id] || null },
		receipts: { record },
		now: () => clock,
	}));
	app.use(express.json({ limit: "200kb" }));
	app.post("/api/v1/echo", (request, response) => response.json({ data: request.body }));
	app.use(notFoundHandler);
	app.use(errorHandler);
	server = app.listen(0, "127.0.0.1");
	await new Promise((resolve) => server.once("listening", resolve));
	base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
afterAll(() => server.close());
const post = (body, headers = {}, token = "tok1") => fetch(`${base}/webhook-sink/${token}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
const signed = (body, deliveryId, ts = Math.floor(clock / 1000)) => ({ "x-rheostat-subscription": subscriptionId, "x-rheostat-delivery": deliveryId, "x-rheostat-event": "flag.archived", "x-rheostat-signature": sign("sec", body, ts) });

describe("webhook sink over HTTP", () => {
	test("accepts a body signed over the exact bytes (whitespace preserved) → 204, receipt valid", async () => {
		const body = '{ "id": "1",  "n": 1.10 }';
		const response = await post(body, signed(body, "d1"));
		expect(response.status).toBe(204);
		expect(state.receipts.at(-1)).toMatchObject({ signatureValid: true, duplicate: false, body });
	});
	test("a duplicate valid delivery is still 204 and counted on the same receipt; concurrent duplicates yield one document", async () => {
		const body = '{"id":"1"}';
		await post(body, signed(body, "d2"));
		const again = await post(body, signed(body, "d2"));
		expect(again.status).toBe(204);
		expect(again.headers.get("x-rheostat-received-count")).toBe("2");
		expect(state.receipts.filter((r) => r.dedupeKey === "d2")).toHaveLength(1);
		const burst = await Promise.all(Array.from({ length: 5 }, () => post(body, signed(body, "d2-burst"))));
		expect(burst.every((r) => r.status === 204)).toBe(true);
		const docs = state.receipts.filter((r) => r.dedupeKey === "d2-burst");
		expect(docs).toHaveLength(1);
		expect(docs[0].receivedCount).toBe(5);
	});
	test("a Project B subscription with a valid Project B signature is rejected on Project A's sink", async () => {
		const body = '{"id":"cross"}';
		const headers = { "x-rheostat-subscription": otherProjectSubscriptionId, "x-rheostat-delivery": "cross-1", "x-rheostat-event": "flag.archived", "x-rheostat-signature": sign("sec2", body, Math.floor(clock / 1000)) };
		const onOwnSink = await post(body, headers, "tok2");
		expect(onOwnSink.status).toBe(204);
		const onOtherSink = await post(body, headers, "tok1");
		expect(onOtherSink.status).toBe(401);
		expect((await onOtherSink.json()).error.details.reason).toBe("unknown subscription");
		expect(state.receipts.at(-1)).toMatchObject({ projectId: "p1", signatureValid: false, subscriptionId: null });
	});
	test("mismatch, expired, malformed, unknown subscription → 401 SIGNATURE_INVALID with the reason; receipts recorded", async () => {
		const body = '{"id":"3"}';
		const mismatch = await post(body, { ...signed(body, "d3"), "x-rheostat-signature": sign("wrong", body, Math.floor(clock / 1000)) });
		expect(mismatch.status).toBe(401);
		expect((await mismatch.json()).error).toMatchObject({ code: "SIGNATURE_INVALID", details: { reason: "mismatch" } });
		const expired = await post(body, signed(body, "d4", Math.floor(clock / 1000) - 301));
		expect((await expired.json()).error.details.reason).toBe("expired");
		const malformed = await post(body, { ...signed(body, "d5"), "x-rheostat-signature": "nope" });
		expect((await malformed.json()).error.details.reason).toBe("malformed");
		const unknown = await post(body, { ...signed(body, "d6"), "x-rheostat-subscription": new mongoose.Types.ObjectId().toString() });
		expect((await unknown.json()).error.details.reason).toBe("unknown subscription");
		expect(state.receipts.filter((r) => !r.signatureValid)).toHaveLength(4);
	});
	test("unknown token → 404; body over 16 kB → 413 with a request id; global JSON parsing is unaffected", async () => {
		expect((await post("{}", {}, "nope")).status).toBe(404);
		const big = JSON.stringify({ pad: "x".repeat(17 * 1024) });
		const tooBig = await post(big, signed(big, "d7"));
		expect(tooBig.status).toBe(413);
		expect((await tooBig.json()).error.requestId).toBeTruthy();
		const echo = await fetch(`${base}/echo`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"a":1}' });
		expect((await echo.json()).data).toEqual({ a: 1 });
	});
	test("rate limit: the 121st request in a minute → 429", async () => {
		const body = '{"id":"r"}';
		let last;
		for (let index = 0; index < 105; index += 1) last = await post(body, signed(body, `r${index}`));
		expect(last.status).toBe(204);
		expect((await post(body, signed(body, "r-final"))).status).toBe(429);
	});
});
```

(The first five tests send 15 requests to `tok1`; the rate-limit test sends 105 more to reach 120 (`for index < 105`), asserts the 120th is 204, and the 121st is 429. The limiter key is the token, so `tok2` requests do not count.)

- [ ] **Step 3: Run** → 7 pass. `bun test` → all pass.

### Task W5D: Event wiring in owning services

**Files:** Modify `backend/src/features/flags/flag.service.js`, `backend/src/features/change-requests/change-request.service.js`, `backend/src/features/rollouts/reconcile.js`, `backend/src/features/rollouts/reconcile.test.js`, `backend/src/features/rollouts/rollout.service.js`, `backend/src/features/governance/governance.test.js` (no change expected; run it).

Follow the emission matrix (spec §9.2). Every `emit` call sits **after** the owning audit write on the same code path.

- [ ] **Step 1: `flag.service.js`** — import `webhookEvents` from `../webhooks/events.js` and `projectService` from `../projects/project.service.js`.
  - `writeVersion`: after the `if (audit) { await auditService.record(…) }` block add:
    ```js
    if (audit) {
    	const project = await projectService.getById(flag.projectId);
    	await webhookEvents.emit({ event: "flag.config.updated", eventId: `flag:${flag._id}:${environment}:v${version.version}:config`, project, environment, flag, data: { environment, version: version.version, source, reason, actorId: String(actorId), changeRequestId: changeRequestId ? String(changeRequestId) : null } });
    }
    ```
    With `audit: false` nothing is emitted here (the caller owns it).
  - `activateKillSwitch` / `clearKillSwitch`: capture the audit entry (`const entry = await auditService.record(…)`) and emit `{ event: "flag.killSwitch.activated", eventId: \`audit:${entry._id}\`, project, flag, data: { reason, actorId: String(actor._id) } }` / `"flag.killSwitch.cleared"` with `data: { actorId }` — the audit entry is the durable record of the transition, so its id is the event's identity.
  - `setArchived`: same pattern: `event: archived ? "flag.archived" : "flag.restored"`, `eventId: \`audit:${entry._id}\``, `data: { actorId }`.

- [ ] **Step 2: `change-request.service.js` `apply`** — after the `changeRequest.applied` audit record:
    ```js
    await webhookEvents.emit({ event: "flag.config.updated", eventId: `flag:${flag._id}:${environment.key}:v${written.version.version}:config`, project, environment: environment.key, flag, data: { environment: environment.key, version: written.version.version, source: "changeRequest", reason: changeRequest.title, actorId: String(profile._id), changeRequestId: String(changeRequest._id) } });
    await webhookEvents.emit({ event: "changeRequest.applied", eventId: `cr:${changeRequest._id}:applied`, project, environment: environment.key, flag, data: { changeRequestId: String(changeRequest._id), environment: environment.key, appliedVersion: written.version.version, title: changeRequest.title, authorId: String(changeRequest.authorId), appliedBy: String(profile._id) } });
    ```

- [ ] **Step 3: Reconciler** — `createReconciler` gains `events = { emit: async () => {} }`. In `finalize` after `audit.recordOnce` (step applied):
    ```js
    await events.emit({ event: "flag.config.updated", eventId: `flag:${flag._id}:${plan.environment}:v${version}:config`, projectId: flag.projectId, environment: plan.environment, flag, data: { environment: plan.environment, version, source: "rollout", reason: `Rollout step ${step.percent}%`, actorId: String(plan.createdBy), rolloutPlanId: String(plan._id), stepId: step.id } });
    await events.emit({ event: "rollout.stepApplied", eventId: appliedKey(plan._id, step.id), projectId: flag.projectId, environment: plan.environment, flag, data: { planId: String(plan._id), environment: plan.environment, percent: step.percent, version } });
    ```
    after the completion audit: `rollout.completed` with `eventId: \`rollout:${plan._id}:completed\``, `data: { planId, environment, percent: step.percent }`; in `stall` after its audit: `rollout.stalled` with `eventId: \`rollout:${plan._id}:stalled:${extra.version ?? "?"}\``, `data: { planId, environment, stallReason: reason, expectedVersion: plan.expectedVersion, currentVersion: extra.version ?? null }`.
    `rollout.service.js` adapter: `events: { emit: async ({ projectId, ...rest }) => webhookEvents.emit({ ...rest, project: await projectService.getById(projectId) }) }`. `abort`: after its audit: `webhookEvents.emit({ event: "rollout.aborted", eventId: \`rollout:${plan._id}:aborted\`, project, environment: plan.environment, flag, data: { planId: String(plan._id), environment: plan.environment, currentPercent: currentPercent(plan), actorId: String(profile._id) } })`. The reconciler's own audit entries (`stepApplied`, `stalled`, `completed`) pass `actorKind: "system"` through `audit.recordOnce` (actor stays `plan.createdBy`).
    `reconcile.test.js` harness: add `events: { emit: async (input) => state.events.push(input) }` and assert: applying a step emits exactly `["flag.config.updated", "rollout.stepApplied"]` with ids `flag:flag1:production:v4:config` / `rollout:plan1:s1:applied`; every `audit.recordOnce` entry carries `actorKind: "system"`; completion adds `rollout.completed`; stall emits `rollout.stalled`; the recovery case "version present but audit missing" emits the same two ids again (dedupe is the repository's unique index, proven in W3 step 10).

- [ ] **Step 4: Verify** — `bun test` → all pass. Start the app; with `source tokens.sh` and a sink subscription (create as Marcus with all events): archive and restore `wishlist-sharing`, activate/clear the kill switch on `express-returns`, save a development targeting change on `express-returns` as Diego, apply the approved storefront change request as Marcus, promote `search-page-size` into development → `GET /webhooks/<id>/deliveries` lists, newest first: `flag.config.updated` (promotion), `changeRequest.applied`, `flag.config.updated` (changeRequest), `flag.config.updated` (direct), `flag.killSwitch.cleared`, `flag.killSwitch.activated`, `flag.restored`, `flag.archived` — exactly one each; every audit entry for those actions precedes its delivery's `createdAt`. Stop Mongo writes to deliveries (temporarily rename the collection with `mongosh db.webhookdeliveries.renameCollection("x")`), archive a flag → the archive succeeds and the log shows `webhook.emit.failed`; rename back.

### Task W5E: Ticker, startup, shutdown

**Files:** Modify `backend/src/index.js`, `backend/src/app.js` (mount the three authenticated routers).

- [ ] **Step 1: Mount** — in `app.js` after the rollout routers: `app.use("/api/v1/projects/:projectKey/webhooks", projectWebhookRouter); app.use("/api/v1/webhooks", webhookRouter); app.use("/api/v1/deliveries", deliveryRouter);` (imports from `./features/webhooks/webhook.routes.js`).

- [ ] **Step 2: Ticker** — in `index.js`:
    ```js
    const WEBHOOK_TICK_MS = 5000;
    const webhookTicker = setInterval(() => {
    	webhookService.dispatchDue(new Date()).catch((error) => logger.error("webhook.tick.failed", { error }));
    }, WEBHOOK_TICK_MS);
    ```
    and `clearInterval(webhookTicker);` in `shutdown` next to the rollout ticker. Log `server.started` with `{ tickers: ["rollouts:30000", "webhooks:5000"] }`.

- [ ] **Step 3: Verify** — start; log shows the tickers; `mongosh` set a delivery to `status: "delivering", claimedAt: new Date(Date.now() - 120000)` → within 5 s it is re-sent; SIGINT stops cleanly (`server.stopping` line, process exits).

### Task W6: Deterministic seed

**Files:** Create `backend/src/scripts/seed/webhooks.js`; modify `backend/src/scripts/seed.js`.

**Interfaces:** `seedWebhooks(projects, flags, people) → { subscriptions, deliveries, receipts, audit }`. Asserted counts: 3 subscriptions, 14 deliveries (11 delivered, 3 dead), 11 receipts, 6 audit entries.

- [ ] **Step 1: Seeder with explicit fixtures**

```js
import { randomBytes } from "node:crypto";
import { SYSTEM_ACTOR_ID } from "../../shared/auth/system-actor.js";
import { BACKOFF_MS } from "../../features/webhooks/dispatch.js";
import { sign } from "../../features/webhooks/signature.js";
import { WebhookDelivery } from "../../features/webhooks/webhook-delivery.model.js";
import { WebhookReceipt } from "../../features/webhooks/webhook-receipt.model.js";
import { WebhookSubscription } from "../../features/webhooks/webhook-subscription.model.js";
import { daysAgo } from "./clock.js";

const SINK = (project) => `http://localhost:8000/api/v1/webhook-sink/${project.webhookSink.token}`;

// Delivered fixtures mirror events the flag/rollout seeders already wrote, by explicit reference — never discovered at run time.
const DELIVERED = {
	storefront: [
		{ event: "flag.killSwitch.activated", flag: "payments-v2", at: daysAgo(9, 15), data: { reason: "Processor timeouts spiking for EU cards" } },
		{ event: "flag.killSwitch.cleared", flag: "payments-v2", at: daysAgo(8, 15), data: {} },
		{ event: "flag.config.updated", flag: "new-checkout", environment: "production", at: daysAgo(4, 11), data: { version: 2, source: "direct", reason: "Turn targeting on ahead of the rollout; everyone stays on the old checkout" } },
		{ event: "rollout.stepApplied", flag: "new-checkout", environment: "production", at: daysAgo(3, 11), data: { percent: 5, version: 3 } },
		{ event: "flag.config.updated", flag: "new-checkout", environment: "production", at: daysAgo(3, 11), data: { version: 3, source: "rollout", reason: "Rollout step 5%" } },
		{ event: "flag.killSwitch.activated", flag: "payments-v2", at: daysAgo(2, 15), data: { reason: "Elevated payment declines from the new processor" } },
		{ event: "rollout.stepApplied", flag: "new-checkout", environment: "production", at: daysAgo(1, 11), data: { percent: 25, version: 4 } },
		{ event: "flag.config.updated", flag: "new-checkout", environment: "production", at: daysAgo(1, 11), data: { version: 4, source: "rollout", reason: "Rollout step 25%" } },
	],
	mobile: [
		{ event: "rollout.stepApplied", flag: "dark-mode-default", environment: "production", at: daysAgo(9, 11), data: { percent: 50, version: 4 } },
		{ event: "rollout.stepApplied", flag: "dark-mode-default", environment: "production", at: daysAgo(4, 11), data: { percent: 100, version: 5 } },
		{ event: "rollout.completed", flag: "dark-mode-default", environment: "production", at: daysAgo(4, 11), data: { percent: 100 } },
	],
};
const DEAD = [
	{ event: "flag.killSwitch.activated", flag: "payments-v2", at: daysAgo(9, 15), data: { reason: "Processor timeouts spiking for EU cards" } },
	{ event: "flag.killSwitch.cleared", flag: "payments-v2", at: daysAgo(8, 15), data: {} },
	{ event: "flag.killSwitch.activated", flag: "payments-v2", at: daysAgo(2, 15), data: { reason: "Elevated payment declines from the new processor" } },
];
export const SEED_WEBHOOK_COUNTS = { subscriptions: 3, deliveries: 14, delivered: 11, dead: 3, receipts: 11, audit: 6 };

export async function seedWebhooks(projects, flags, people) {
	console.log("\nSeeding webhooks...");
	const marcus = people.byEmail.get("marcus.chen@rheostat.team");
	const storefront = projects.byKey.get("storefront");
	const mobile = projects.byKey.get("mobile");
	const subscription = (project, name, url, events, environments, createdAt, extra = {}) => ({
		_id: new WebhookSubscription()._id, projectId: project._id, name, url, secret: randomBytes(32).toString("hex"), events, environments, enabled: true, disabledReason: null, consecutiveFailures: 0, lastDeliveryAt: null, lastDeliveryStatus: null, createdBy: marcus._id, createdAt, updatedAt: createdAt, ...extra,
	});
	const notifier = subscription(storefront, "Deploy notifier", SINK(storefront), ["flag.config.updated", "flag.killSwitch.activated", "flag.killSwitch.cleared", "flag.archived", "flag.restored", "changeRequest.applied", "rollout.stepApplied", "rollout.stalled", "rollout.completed", "rollout.aborted"], [], daysAgo(20, 10));
	const pager = subscription(storefront, "Legacy pager (decommissioned host)", "http://127.0.0.1:9/hooks", ["flag.killSwitch.activated", "flag.killSwitch.cleared", "rollout.stalled"], ["production"], daysAgo(45, 10), { consecutiveFailures: 3, lastDeliveryStatus: "dead" });
	const channel = subscription(mobile, "Release channel", SINK(mobile), ["rollout.stepApplied", "rollout.stalled", "rollout.completed", "rollout.aborted"], [], daysAgo(15, 10));
	const deliveries = [];
	const receipts = [];
	const audit = [];
	const payloadFor = (project, fixture, id) => {
		const flag = flags.byKey.get(fixture.flag);
		return { id: String(id), event: fixture.event, occurredAt: fixture.at.toISOString(), project: { key: project.key, name: project.name }, ...(fixture.environment ? { environment: fixture.environment } : {}), flag: { key: flag.key, name: flag.name }, data: { ...fixture.data, actorId: String(marcus._id) } };
	};
	for (const [target, project] of [[notifier, storefront], [channel, mobile]]) {
		for (const fixture of DELIVERED[project.key]) {
			const id = new WebhookDelivery()._id;
			const payload = payloadFor(project, fixture, id);
			const body = JSON.stringify(payload);
			const durationMs = 40 + (parseInt(id.toString().slice(-2), 16) % 90);
			deliveries.push({ _id: id, subscriptionId: target._id, projectId: project._id, eventId: String(id), event: fixture.event, payload, status: "delivered", attempts: [{ at: fixture.at, outcome: "delivered", durationMs, responseStatus: 204, responseSnippet: "" }], budgetFrom: 0, nextAttemptAt: fixture.at, claimedAt: null, deliveredAt: fixture.at, createdAt: fixture.at, updatedAt: fixture.at });
			receipts.push({ projectId: project._id, subscriptionId: target._id, dedupeKey: String(id), deliveryId: String(id), event: fixture.event, firstReceivedAt: fixture.at, lastReceivedAt: fixture.at, receivedCount: 1, headers: { "x-rheostat-event": fixture.event, "x-rheostat-delivery": String(id), "x-rheostat-subscription": String(target._id), "x-rheostat-signature": sign(target.secret, body, Math.floor(fixture.at.getTime() / 1000)) }, body, signatureValid: true, signatureError: "" });
			target.lastDeliveryAt = fixture.at;
			target.lastDeliveryStatus = "delivered";
		}
	}
	for (const fixture of DEAD) {
		const id = new WebhookDelivery()._id;
		let at = fixture.at.getTime();
		const attempts = BACKOFF_MS.map((delay) => { at += delay; return { at: new Date(at), outcome: "failed", durationMs: 3, error: "connect ECONNREFUSED 127.0.0.1:9" }; });
		deliveries.push({ _id: id, subscriptionId: pager._id, projectId: storefront._id, eventId: String(id), event: fixture.event, payload: payloadFor(storefront, fixture, id), status: "dead", attempts, budgetFrom: 0, nextAttemptAt: fixture.at, claimedAt: null, deliveredAt: null, createdAt: fixture.at, updatedAt: attempts.at(-1).at });
		pager.lastDeliveryAt = attempts.at(-1).at;
		audit.push({ projectId: storefront._id, actorId: SYSTEM_ACTOR_ID, actorKind: "system", action: "webhook.deliveryDead", entityType: "webhook", entityId: String(pager._id), entityLabel: pager.name, summary: `Delivery of ${fixture.event} to ${pager.name} failed 5 times and was dead-lettered.`, metadata: { deliveryId: String(id), event: fixture.event, attempts: 5, lastError: "connect ECONNREFUSED 127.0.0.1:9" }, at: attempts.at(-1).at });
	}
	const subscriptions = [notifier, pager, channel];
	for (const entry of subscriptions) {
		audit.push({ projectId: entry.projectId, actorId: marcus._id, action: "webhook.created", entityType: "webhook", entityId: String(entry._id), entityLabel: entry.name, summary: `Marcus Chen added webhook "${entry.name}" (${entry.events.length} events).`, metadata: { url: entry.url, events: entry.events }, at: entry.createdAt });
	}
	await WebhookSubscription.insertMany(subscriptions);
	await WebhookDelivery.insertMany(deliveries);
	await WebhookReceipt.insertMany(receipts);
	const actual = { subscriptions: subscriptions.length, deliveries: deliveries.length, delivered: deliveries.filter((d) => d.status === "delivered").length, dead: deliveries.filter((d) => d.status === "dead").length, receipts: receipts.length, audit: audit.length };
	for (const [key, expected] of Object.entries(SEED_WEBHOOK_COUNTS)) if (actual[key] !== expected) throw new Error(`Webhook seed drift: ${key} expected ${expected}, got ${actual[key]}`);
	console.log(`  Created ${actual.subscriptions} webhooks, ${actual.deliveries} deliveries (${actual.dead} dead), ${actual.receipts} receipts`);
	return { subscriptions, deliveries, receipts, audit };
}
```

- [ ] **Step 2: `seed.js`** — `const webhooks = await seedWebhooks(projects, flags, people);` after `seedRollouts`, and `...webhooks.audit` in `seedAudit`.

- [ ] **Step 3: Verify** — `bun run seed` prints `Webhooks: 3`, `Deliveries: 14`, `Receipts: 11`, `Audit entries: 114`; `mongosh --quiet --eval 'db.webhookdeliveries.countDocuments({status:"dead"})'` → 3. Restart the app: no seeded delivery is re-sent (none is `pending`).

### Task W7A: Frontend API, routing, primitives

**Files:**
- Create: `frontend/src/features/webhooks/webhook.api.js`, `frontend/src/features/webhooks/StatusBadge.jsx`, `frontend/src/features/webhooks/StatusBadge.test.jsx`, `frontend/src/features/webhooks/AttemptTimeline.jsx`, `frontend/src/features/webhooks/AttemptTimeline.test.jsx`, `frontend/src/features/webhooks/EventPicker.jsx`
- Modify: `frontend/src/shared/router/match.js` (add `{ name: "webhook", pattern: "/projects/:projectKey/webhooks/:id" }` before `settings`), `frontend/src/shared/router/match.test.js` (one case), `frontend/src/features/shell/Workspace.jsx` (`if (name === "webhook") return <WebhookDetailPage id={params.id} key={params.id} />;`)

**Interfaces:**
- Produces: `webhookApi = { list(projectKey), create(projectKey, input), get(id), update(id, patch), remove(id), deliveries(id, { status, cursor }), delivery(id), redeliver(deliveryId), test(id), receipts(projectKey), clearReceipts(projectKey) }` (mutations `invalidate(\`webhooks:${projectKey}\`)`); `WEBHOOK_EVENT_GROUPS` (mirror of the backend catalogue); `StatusBadge({ subscription })`, `DeliveryStatusBadge({ status })`, `AttemptTimeline({ attempts, nextAttemptAt, status, budgetFrom })`, `EventPicker({ value, onChange, disabled })`.

- [ ] **Step 1: Tests**

`StatusBadge.test.jsx`:

```jsx
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DeliveryStatusBadge, StatusBadge } from "./StatusBadge.jsx";

describe("webhook badges", () => {
	test("subscription states", () => {
		expect(renderToStaticMarkup(<StatusBadge subscription={{ enabled: true }} />)).toContain("Enabled");
		expect(renderToStaticMarkup(<StatusBadge subscription={{ enabled: false, disabledReason: "MANUAL" }} />)).toContain("Disabled");
		const auto = renderToStaticMarkup(<StatusBadge subscription={{ enabled: false, disabledReason: "AUTO_FAILURES" }} />);
		expect(auto).toContain("Auto-disabled");
		expect(auto).toContain("badge-danger");
	});
	test("delivery states map to tones and labels", () => {
		expect(renderToStaticMarkup(<DeliveryStatusBadge status="delivered" />)).toContain("badge-success");
		expect(renderToStaticMarkup(<DeliveryStatusBadge status="dead" />)).toContain("Dead-lettered");
		expect(renderToStaticMarkup(<DeliveryStatusBadge status="pending" />)).toContain("Retrying");
		expect(renderToStaticMarkup(<DeliveryStatusBadge status="held" />)).toContain("Held");
	});
});
```

`AttemptTimeline.test.jsx`:

```jsx
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AttemptTimeline } from "./AttemptTimeline.jsx";

const attempts = [
	{ at: "2026-09-21T10:00:00Z", outcome: "failed", durationMs: 5, responseStatus: 503 },
	{ at: "2026-09-21T10:00:30Z", outcome: "failed", durationMs: 5003, error: "timeout" },
];
describe("AttemptTimeline", () => {
	test("lists attempts with status, duration, error, and the next attempt", () => {
		const html = renderToStaticMarkup(<AttemptTimeline attempts={attempts} budgetFrom={0} nextAttemptAt="2026-09-21T10:02:30Z" status="pending" />);
		expect(html).toContain("Attempt 1");
		expect(html).toContain("HTTP 503");
		expect(html).toContain("5 ms");
		expect(html).toContain("timeout");
		expect(html).toContain("5003 ms");
		expect(html).toContain("Next attempt");
	});
	test("marks where a redelivery restarted the budget", () => {
		const html = renderToStaticMarkup(<AttemptTimeline attempts={attempts} budgetFrom={1} nextAttemptAt={null} status="delivered" />);
		expect(html).toContain("Redelivered");
	});
	test("dead deliveries show the dead-letter note instead of a next attempt", () => {
		const html = renderToStaticMarkup(<AttemptTimeline attempts={[]} budgetFrom={0} nextAttemptAt={null} status="dead" />);
		expect(html).toContain("Dead-lettered");
		expect(html).not.toContain("Next attempt");
	});
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**

`StatusBadge.jsx`:

```jsx
import { Badge } from "../../shared/components/Badge.jsx";

export function StatusBadge({ subscription }) {
	if (subscription.enabled) return <Badge tone="success">Enabled</Badge>;
	if (subscription.disabledReason === "AUTO_FAILURES") return <Badge title="Disabled automatically after 5 consecutive dead-lettered deliveries" tone="danger">Auto-disabled</Badge>;
	return <Badge tone="neutral">Disabled</Badge>;
}

const DELIVERY = { delivered: ["success", "Delivered"], dead: ["danger", "Dead-lettered"], pending: ["warning", "Retrying"], delivering: ["info", "Sending"], held: ["neutral", "Held"] };
export function DeliveryStatusBadge({ status }) {
	const [tone, label] = DELIVERY[status] || ["neutral", status];
	return <Badge tone={tone}>{label}</Badge>;
}
```

`AttemptTimeline.jsx`:

```jsx
import { formatDateTime, relativeTime } from "../../shared/utils/date.js";

const describe = (attempt) => (attempt.responseStatus ? `HTTP ${attempt.responseStatus} · ${attempt.durationMs} ms` : `${attempt.error} · ${attempt.durationMs} ms`);

export function AttemptTimeline({ attempts, budgetFrom = 0, nextAttemptAt, status }) {
	return (
		<ol className="attempt-timeline">
			{attempts.map((attempt, index) => (
				<li className={`attempt attempt-${attempt.outcome}`} key={`${attempt.at}-${index}`}>
					{budgetFrom > 0 && index === budgetFrom && <span className="attempt-marker">Redelivered — retry budget restarted</span>}
					<strong>Attempt {index + 1}</strong>
					<time dateTime={attempt.at} title={formatDateTime(attempt.at)}>{relativeTime(attempt.at)}</time>
					<span>{describe(attempt)}</span>
				</li>
			))}
			{status === "pending" && nextAttemptAt && (
				<li className="attempt attempt-next">
					<strong>Next attempt</strong>
					<time dateTime={nextAttemptAt} title={formatDateTime(nextAttemptAt)}>{relativeTime(nextAttemptAt)}</time>
				</li>
			)}
			{status === "held" && <li className="attempt attempt-next"><strong>Held</strong><span>The webhook is disabled; enable it to resume.</span></li>}
			{status === "dead" && <li className="attempt attempt-dead"><strong>Dead-lettered</strong><span>No more automatic retries. Redeliver to try again.</span></li>}
			{attempts.length === 0 && status !== "dead" && <li className="attempt"><span className="muted">Not sent yet.</span></li>}
		</ol>
	);
}
```

`EventPicker.jsx`: checkbox groups from `WEBHOOK_EVENT_GROUPS` (`{ flag: [...], changeRequest: [...], rollout: [...] }` — `webhook.test` is not user-selectable), a "Select all" checkbox per group, `fieldset`/`legend` per group, controlled by `value` (array) and `onChange(nextArray)`.

`webhook.api.js`: one function per route using `request` and `stringifyQuery`; every mutating call ends with `invalidate(\`webhooks:${projectKey}\`)` — `update/remove/redeliver/test` receive `projectKey` as an extra last argument for that purpose.

- [ ] **Step 4: Run** → 5 pass; `match.test.js` case: `matchRoute("/projects/storefront/webhooks/abc")` → `{ name: "webhook", params: { projectKey: "storefront", id: "abc" } }`.

### Task W7B: Settings tab, create and edit dialogs

**Files:** Create `frontend/src/features/webhooks/WebhooksTab.jsx`, `frontend/src/features/webhooks/WebhookFormDialog.jsx`, `frontend/src/features/webhooks/SecretReveal.jsx`; modify `frontend/src/features/projects/ProjectSettingsPage.jsx` (tabs `Environments | People | Webhooks` via `?tab=`), `frontend/src/styles.css`.

- [ ] **Step 1: `WebhooksTab`** — `useAsync(() => webhookApi.list(project.key), [project.key], { key: \`webhooks:${project.key}\` })`. Sink card: `<code>{sinkUrl}</code>`, Copy (`navigator.clipboard.writeText` + toast "Receiver URL copied"), "Clear inbox" when `canManage` (`ConfirmationDialog`). Table columns: Name (link to `buildPath("webhook", { projectKey, id })`), Host (`new URL(url).host`), Events (`n events`, `title` lists them), Environments ("All" or names), Status (`StatusBadge`), Delivered / Dead / Held counts, Last delivery (`relativeTime` or "Never"). Row actions when `canManage`: Test (toast "Test delivered (HTTP 204 in 38 ms)" or "Test failed: HTTP 503 — retrying"), Enable/Disable, Delete (`ConfirmationDialog`). Header button "New webhook". Empty state: "No webhooks yet" / "Notify your tools when flags change." with the primary action. Errors: `ErrorBanner` with `requestId`.

- [ ] **Step 2: `WebhookFormDialog`** — props `{ initial (null for create), projectKey, sinkUrl, onClose, onSaved(result) }`. Fields: Name (`FormField`, required), URL (`FormField`; client check `new URL()` and `http(s):` → inline "Enter an absolute http(s) URL."), text button "Use the built-in test receiver" (fills URL with `sinkUrl`), `EventPicker` (inline "Choose at least one event."), environment toggles (three chips; none = all), submit "Create webhook" / "Save changes". Server `VALIDATION_ERROR` details map to fields via `fieldErrors`. On create success the dialog body becomes `SecretReveal`.

- [ ] **Step 3: `SecretReveal`** — `{ secret, onDone }`: `<code className="secret-reveal">{secret}</code>`, Copy button, warning "This is the only time the secret is shown. Store it with the receiver.", "Done".

- [ ] **Step 4: CSS** — `.sink-card`, `.secret-reveal { user-select: all; overflow-wrap: anywhere; }`, `.event-picker { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }`, `.event-picker fieldset { border: 1px solid var(--divider); border-radius: 10px; padding: 8px 12px; }`.

- [ ] **Step 5: Verify** — `bunx vite build`; browser: create/edit flows render, validation messages inline, secret shown once.

### Task W7C: Detail page and delivery history

**Files:** Create `frontend/src/features/webhooks/WebhookDetailPage.jsx`, `frontend/src/features/webhooks/DeliveryList.jsx`, `frontend/src/features/webhooks/DeliveryDrawer.jsx`; modify `frontend/src/styles.css`.

- [ ] **Step 1: `WebhookDetailPage({ id })`** — `useAsync(() => webhookApi.get(id), [id], { key: \`webhook:${id}\` })`; breadcrumb Settings › Webhooks › name (link to `buildPath("settings", { projectKey }, { tab: "webhooks" })`); header: `StatusBadge`, URL, events chips, environments; breaker banner when `disabledReason === "AUTO_FAILURES"`: "Disabled after 5 consecutive dead-lettered deliveries. Fix the endpoint, then enable it to resume held deliveries."; actions when `permissions.canManage`: Test, Enable/Disable, Edit (`WebhookFormDialog` with `initial`), Rotate secret (`ConfirmationDialog` → `update(id, { rotateSecret: true })` → `SecretReveal`), Delete (confirm → navigate to settings). Not-found → `EmptyState` "Webhook not found".

- [ ] **Step 2: `DeliveryList({ subscriptionId, canManage })`** — status `SelectMenu` (Any / Delivered / Retrying / Held / Dead-lettered) bound to `?status=`; own state `{ items, nextCursor, loading, error }`; first page on mount and on filter change; "Load more" appends `webhookApi.deliveries(id, { status, cursor: nextCursor })`; rows: event, `DeliveryStatusBadge`, attempts count, last attempt summary (`HTTP 204 · 38 ms` / `timeout · 5003 ms`), created `relativeTime`; click opens `DeliveryDrawer`. Empty: "No deliveries yet — send a test."

- [ ] **Step 3: `DeliveryDrawer({ deliveryId, canManage, onClose, onChanged })`** — `Modal` loading `webhookApi.delivery(id)`; `AttemptTimeline`; payload `<pre className="delivery-payload">`; headers table; Redeliver (`canManage`, disabled while `delivering`/`held` with tooltip): button label "Sending…" during the call, then re-render with the returned delivery and toast "Delivered" or "Failed — next attempt in 30 s".

- [ ] **Step 4: CSS** — `.attempt-timeline` (list reset, left rule, grid rows), `.attempt-failed strong { color: var(--danger) }`, `.attempt-delivered strong { color: var(--success) }`, `.attempt-next, .attempt-marker { color: var(--muted); font-size: 13px }`, `.delivery-payload { max-height: 320px; overflow: auto; }`.

- [ ] **Step 5: Verify** — `bunx vite build`; browser: detail, filter, load more, drawer, redeliver.

### Task W7D: Inbox and dashboard tile

**Files:** Create `frontend/src/features/webhooks/Inbox.jsx`; modify `frontend/src/features/webhooks/WebhooksTab.jsx`, `backend/src/features/dashboard/dashboard.service.js`, `frontend/src/features/dashboard/DashboardPage.jsx`.

- [ ] **Step 1: `Inbox({ projectKey })`** — `useAsync(() => webhookApi.receipts(projectKey), [projectKey])`, Refresh button; rows: event, last received `relativeTime`, signature badge (`Valid` success / `Invalid: <signatureError>` danger), a `×N` warning badge when `receivedCount > 1` (title "Received N times — the sender retried; deduplicated by delivery id"), `<details>` with the body. Empty: "The test receiver has not received anything yet."

- [ ] **Step 2: Dashboard** — `dashboard.service.js` adds `webhooks: await webhookService.stats(project._id)` (`dashboard → webhooks` is a declared read edge). `DashboardPage.jsx`: `StatTile` "Dead-lettered deliveries" value `webhooks.deadDeliveries`, tone `danger` when > 0 else `quiet`, link `buildPath("settings", { projectKey }, { tab: "webhooks" })`, caption `${webhooks.subscriptions} webhooks`.

- [ ] **Step 3: Verify** — build; browser shows seeded receipts and the tile value 3 for Storefront.

### Task W7E: Responsive and accessibility pass for the new screens

- [ ] **Step 1:** At 375 px: Webhooks tab (table inside `.table-scroll`), form dialog, detail page, drawer — no horizontal page overflow (`document.documentElement.scrollWidth === innerWidth`); the drawer body scrolls.
- [ ] **Step 2:** Every button has text or `aria-label`; the event picker uses `fieldset/legend`; the secret code block has `aria-label="Webhook secret"`; the drawer `Modal` has `labelledBy`; focus returns to the opener on close (existing `Modal` behaviour).
- [ ] **Step 3:** Dark and light themes: signature badges and attempt colours use the existing tokens (no new hex values).

### Task W8: Phase 6.5 gate

Automated: `bun test` green (signature, cursor, fan-out, events, dispatcher, service, HTTP, sink, reconcile events, badges, timeline); `MONGODB_TEST_URI=mongodb://localhost:27017/rheostat_test bun test` green including the integration suite.

Manual (profile named; `curl` where stated; `source tokens.sh`):

1. Seeded state: Storefront Webhooks tab shows "Deploy notifier" (8 delivered) and "Legacy pager" (3 dead, "3 consecutive failures"); Mobile shows "Release channel" (3 delivered); Inbox lists 8 (Storefront) and 3 (Mobile) receipts, all Valid; dashboard tile reads 3 for Storefront, 0 for Mobile.
2. Create as Marcus: validation (empty name, `ftp://`, no events) inline; built-in receiver, `flag.*` events, production only → secret shown once → Done; Test → toast HTTP 204; Inbox shows `webhook.test` Valid.
3. Sam and Diego: no "New webhook" button, no row actions, detail read-only; `curl` POST as Diego → 403.
4. Events: Marcus activates the kill switch on `express-returns` → within 5 s the deliveries list shows `flag.killSwitch.activated` Delivered and the Inbox has it; clear → second delivery. Diego saves development targeting → no delivery (production filter). Marcus applies the approved storefront change request → `changeRequest.applied` and `flag.config.updated` delivered, in that order of creation after the audit entry.
5. Retry schedule: create "Dead end" → `http://127.0.0.1:9/x`; Test → drawer shows Attempt 1 failed (`connect ECONNREFUSED`, real ms) and "Next attempt in 30 s"; after ~30 s Attempt 2.
6. Dead-letter and breaker (`mongosh` compresses time): `db.webhookdeliveries.updateOne({_id: ObjectId("<id>")}, {$set: {attempts: [/* 4 failed */], nextAttemptAt: new Date()}})` → within 5 s Dead-lettered, audit `webhook.deliveryDead`, counter 1. Set the subscription's `consecutiveFailures: 4`, requeue one dead delivery via Redeliver against the still-dead host and compress its attempts the same way → breaker: badge Auto-disabled, banner, audit `webhook.autoDisabled`, any pending delivery for it shows Held. Enable → held rows become Retrying, counter 0.
7. Redeliver: Edit "Legacy pager" URL to the sink; open a dead delivery → Redeliver → Delivered on attempt 6; timeline shows the "Redelivered — retry budget restarted" marker before attempt 6.
8. Signature failure (hand-made): copy a receipt's headers; `curl -X POST <sinkUrl> -H 'content-type: application/json' -H 'X-Rheostat-Subscription: <id>' -H 'X-Rheostat-Delivery: manual-1' -H 'X-Rheostat-Event: flag.archived' -H 'X-Rheostat-Signature: t=1700000000,v1=<64 zeros>' -d '{}'` → 401 `SIGNATURE_INVALID` reason `expired`; same with `t=<now>` and a wrong digest → reason `mismatch`; Inbox shows both as Invalid with the reason.
9. Duplicate: replay a valid delivery by `curl` using the exact body and headers from a receipt (within 5 minutes of its timestamp: first send a Test, then copy from the Inbox) → 204 with `X-Rheostat-Received-Count: 2`; the Inbox shows one row with ×2. Fire the same replay 5 times in parallel (`for i in 1 2 3 4 5; do curl … & done; wait`) → still one row, count 7.
9b. Cross-project binding: `curl` Storefront's sink URL with the Mobile "Release channel" subscription id and a signature made with its secret (from `mongosh`) → 401 `unknown subscription`; Storefront's Inbox shows it as Invalid.
9c. Automated actor: after item 6, the Audit page shows `webhook.deliveryDead` and `webhook.autoDisabled` attributed to "Rheostat" with the Automated badge, and the rollout step entries also carry the badge while naming Marcus.
10. Cursor pagination: toggle the kill switch 15 times → 30 deliveries; deliveries list with limit 25 → "Load more" appends 5 without repeats; filter Dead-lettered shows only dead.
11. Crash recovery: `mongosh` set a delivery `status: "delivering", claimedAt: new Date(Date.now()-120000)` → within 5 s it is sent.
12. Restart: no seeded delivery re-sent; `server.started` lists both tickers.
13. Delete a subscription → deliveries gone (`countDocuments({subscriptionId})` = 0); audit `webhook.deleted`.
14. Enqueue failure path (`mongosh` rename `webhookdeliveries` → `x`): archive a flag → succeeds; log `webhook.emit.failed`; rename back.

Append the log entry.

---

## Phase 7 additions

### Task 7.5: Component tests for existing components

**Files:** Create `frontend/src/shared/components/DiffView.test.jsx`, `frontend/src/shared/components/Pagination.test.jsx`, `frontend/src/features/change-requests/StatusBadge.test.jsx`, `frontend/src/features/flags/EnvironmentStatePill.test.jsx`, `frontend/src/features/rollouts/RolloutTimeline.test.jsx`.

- [ ] **Step 1: `DiffView.test.jsx`** (the empty-state copy is `No configuration changes.` — verified in `DiffView.jsx:44`):

```jsx
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DiffView } from "./DiffView.jsx";

const variations = [{ id: "v_true", name: "True" }, { id: "v_false", name: "False" }];
describe("DiffView", () => {
	test("renders changed and added entries with variation names and rule descriptions", () => {
		const html = renderToStaticMarkup(
			<DiffView
				diff={[
					{ path: "enabled", kind: "changed", before: false, after: true },
					{ path: "fallthrough", kind: "changed", before: { variationId: "v_true" }, after: { variationId: "v_false" } },
					{ path: "rules.r_1", kind: "added", before: null, after: { id: "r_1", description: "Beta testers", clauses: [{ attribute: "key", operator: "segmentMatch", values: ["beta-testers"], negate: false }], serve: { variationId: "v_true" } } },
				]}
				variations={variations}
			/>,
		);
		expect(html).toContain("Targeting");
		expect(html).toContain("Serve True");
		expect(html).toContain("Serve False");
		expect(html).toContain("Beta testers");
		expect(html).toContain("segmentMatch");
	});
	test("empty diff renders the no-change message", () => {
		expect(renderToStaticMarkup(<DiffView diff={[]} variations={variations} />)).toContain("No configuration changes.");
	});
});
```

- [ ] **Step 2: `Pagination.test.jsx`** — `page=1,pageSize=20,total=45` renders "1–20 of 45" and "Page 1 of 3", previous disabled; `page=3` → next disabled.
- [ ] **Step 3: change-request `StatusBadge.test.jsx`** — six statuses → labels and tones (`pending → badge-info`, `approved → badge-success`, `conflicted → badge-warning`, `applied → badge-success`, `rejected → badge-danger`, `withdrawn → badge-neutral`); `KindBadge` labels Targeting change / Promotion / Rollback.
- [ ] **Step 4: `EnvironmentStatePill.test.jsx`** — off state text, on state, rollout percentage "25%" when the fallthrough is a rollout, kill-switch override.
- [ ] **Step 5: `RolloutTimeline.test.jsx`** — one `<circle>` per step, a "now" line, applied steps carry the applied class, `<title>` and `<desc>` present.
- [ ] **Step 6: Run** `bun test frontend` → all pass; a failure is a real regression to fix in the component.

### Task 7.6: README engineering notes (extends Task 7.1)

Add after "How Rheostat works":

```markdown
## Engineering notes

| Concept | Where | Trade-off taken |
|---|---|---|
| Optimistic concurrency | `flagRepository.mutateEnvironment` (version-guarded `findOneAndUpdate`) | One guarded write is the lock and the drift detector; no distributed lock, no transactions (a version is one subdocument). |
| Idempotency | `auditService.recordOnce`; unique `(rolloutPlanId, stepId)` on flag versions; unique `(subscriptionId, eventId)` on deliveries; `X-Rheostat-Delivery` for receivers | Deterministic ids for automated writers, random for interactive ones. |
| Background jobs and crash recovery | `features/rollouts/reconcile.js` (30 s tick, timestamped claims, four recovery cases); `features/webhooks/dispatch.js` (5 s tick, stale-claim release) | Claims with timestamps instead of leases; stale claims resolve deterministically. |
| Queue, retries, backoff, dead-letter, breaker | `features/webhooks` (`WebhookDelivery` as the queue, `BACKOFF_MS`, `MAX_ATTEMPTS`, `BREAKER_THRESHOLD`, `held` deliveries, disabled subscriptions excluded at claim time) | Fixed schedule, one worker; **delivery is at-least-once after a successful enqueue; enqueue is best-effort and logged** (`webhook.emit.failed`); the post-enqueue dispatch kick is separate and best-effort (`webhook.dispatch.kick.failed`) — an outbox is out of scope. |
| Idempotent consumer | the built-in sink: unique `(projectId, dedupeKey)` receipts with an atomic upsert and `receivedCount` | Duplicate detection is atomic at the database, not check-then-insert. |
| Signed payloads and secrets | `features/webhooks/signature.js` (HMAC-SHA256 with timestamp, constant-time compare); secrets shown once | Rotation invalidates receivers until they update. |
| Rate limiting | `shared/middleware/rate-limit.js` on login, evaluate, sink | Fixed window, in-memory; boundary bursts accepted. |
| Structured logging and correlation | `shared/logging/logger.js`, `shared/middleware/request-context.js`, `requestId` in every error envelope, frontend-generated ids | JSON lines to stdout; the seed keeps human-readable output on purpose. |
| RBAC/ABAC | `shared/auth/permissions.js` (role × environment protection × authorship) | Context-aware `can()`. Authorization is account-wide by design (no per-project membership); the webhook tests prove resource-relationship integrity (a delivery is only reachable through its own subscription and project; sink tokens bind to their project's subscriptions), not a per-project access boundary. |
| Automated vs user actions | `shared/auth/system-actor.js`, `AuditEntry.actorKind` | Worker-written audit entries name the system actor; rollout steps keep the creator's authority but are marked automated. |
| Audit logging | every mutating service awaits `auditService.record`; webhooks emit only after the owning audit succeeds | An unaudited change is a failed request. |
| Indexing and cursor pagination | partial unique index for one active rollout per flag × environment; sparse unique idempotency keys; `(createdAt, _id)` cursors on deliveries; `before` cursor on audit | Offset pagination for sorted, filtered user lists; cursors for append-only streams. |
| Health checks | `GET /api/v1/health` | 503 when Mongo is down. |
| Frontend: cache and dedup | `shared/api/cache.js` (generations, identity-safe in-flight cleanup), `shared/hooks/useAsync.js` | Explicit keys, stale-while-revalidate, committed server data only. |
| Frontend: optimistic updates | comments, rollout pause/resume, kill-switch clear | Only where failure is rare and the rollback is a local swap. |
| Frontend: boundaries, splitting, skeletons, accessibility | `ErrorBoundary.jsx`, `Workspace.jsx` (`lazy` + `Suspense`), native `<dialog>` with focus restore | Route-level boundaries. |
| Tests | pure business rules, fake-backed workers, real-HTTP tests over fakes, DOM-free render tests, opt-in Mongo integration suite (`MONGODB_TEST_URI`) | No DOM shim (dependency freeze); interaction verified in browser gates. |

**What a multi-process deployment would change.** The rate-limit store and client cache would move to Redis; the two tickers would take a lease; deliveries would move to a broker with the same claim semantics; enqueue would become a transactional outbox; logs would ship to a collector keyed by `requestId`.
```

### Phase 7 gate additions

- `bun test` ≥ 190 tests green without Mongo; the integration suite green with `MONGODB_TEST_URI`.
- `grep -rn "console\." backend/src --include=*.js | grep -v scripts/` empty.
- Every webhook route has a UI consumer (list, create, detail, update, delete, deliveries, delivery, redeliver, test, receipts, clear).
- README table paths all exist.

---

## Self-review

**Spec coverage.** §1 → 6.5 (middleware order, envelopes, HTTP tests for malformed JSON/413, frontend id generation and echo capture); §2 → 6.6 + W5C sink limiter; §3 → 6.7; §4 → 6.8 (behavioural verification); §5 + coherence policy → 6.10 (`mutate(…, { commit })`); §6 generations, identity-safe cleanup, key changes → 6.9; §7 → W7A, 7.5; §8 → 7.6; §9.2 matrix and ownership rule → W5D; §9.3 guarantee → 7.6 and W5D step 4; §9.4 models incl. `held`/`budgetFrom`/sink token → W1; §9.5 worker incl. `dispatchOne`, real durations, redelivery budget, held → W4; §9.6 sink statuses and raw body → W5C; §9.7 scoping → W5A/W5B tests; §9.8 API incl. compound cursor → W3/W5A/W5B; §9.9 graph → W5A imports (`projects`, `audit`) and W5D; §9.10 testability → W5A/W5B/W5C/W3 integration; §9.11 UI → W7A–E; §9.12 seed counts → W6; §9.13 → W8 items 4–14.

**Placeholder scan.** No "if needed", "adjust", "check and add". `EmptyState` `id` prop is specified in 6.7 step 3. `projectRepository.findBySinkToken` is specified in W1 step 7. `DiffView` empty copy is the verified string. Seed counts are fixed and asserted by the seeder itself.

**Type consistency.** `createRateLimiter` (6.6, W5C); `ApiError { requestId, retryAfterSeconds }` (6.5, 6.6); `useAsync(loader, deps, { key, staleMs })` and `mutate(updater, { commit })` (6.9, 6.10, W7); `dedupe/readCache/writeCache/invalidate/clearCache/currentGeneration` (6.9 test and impl); `deliveryRepository.{claimNext, claimById, releaseStale, finish, requeue(id, now, budgetFrom), holdPending, releaseHeld, findPage(sid, { status, cursor, limit }), countByStatus, insertMany, removeForSubscription, findById}` used identically by W3, W4 dep shapes, W5A fakes; `subscriptionRepository.{findById, findByProject, findEnabledByProject, countByProject, create, update, remove, recordOutcome, disableAuto}` likewise; `createEvents({ subscriptions, deliveries, log, dispatchNow }).{enqueue, emit}` (W3, W5A) with `onlySubscriptionId` (W3 fan-out test 3, W5A `test()`); `sign/verify` (W2, W4, W5C, W6); `encodeCursor/decodeCursor/cursorPredicate/toObjectIdPredicate` (W3, W5A); `createWebhookService` deps `{ subscriptions, deliveries, receipts, projects, audit, send, apiOrigin, clock, log }` (W5A impl and test harness, W5B via `test-harness.js`); `createWebhookRouters(service, { projects, people })` (W5B, W5E); `createSinkRouter({ projects, subscriptions, receipts: { record }, now })` (W5C); `receiptRepository.record` (W3, W5C, W6 fixture fields `dedupeKey/firstReceivedAt/lastReceivedAt/receivedCount`); `claimNext(now, excludeSubscriptionIds)` and `subscriptions.findDisabledIds()` (W3, W4 fakes, W5A fakes); `SYSTEM_ACTOR`/`actorKind` (W1, W4, W5D, W6); deterministic `eventId` at every emit site (W5A `test()` random, W5D all others); `DELIVERY_STATUSES` includes `held` (W1, W5B schema, W7A badge).
