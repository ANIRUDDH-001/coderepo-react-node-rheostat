# Rheostat hardening — design (revision 3)

Addendum to `2026-09-18-rheostat-design.md`. It adds one subsystem (outbound webhooks) and eight cross-cutting engineering improvements, chosen after reviewing the product against the team's "Guidelines for Repository and Feature Ideas". Everything here respects the binding constraints of the original spec §2: the dependency freeze (GUIDELINES §2.2), the HackerRank runtime limits (no WebSockets, no external hosted services, no outbound email; GUIDELINES §2.4), the frozen stack (React 19 / Vite 8 / Express 5 / Mongoose 8 / Zod 4 / Bun), the `{ data }` / `{ error }` envelopes, and the acyclic service graph (§5.13).

Revision 3 adds: sink project↔subscription binding, claim exclusion of disabled subscriptions, atomic receipt dedupe, deterministic ids for every automated business event, enqueue/kick separation, a system actor for automated audit entries, generation-aware mutations with pure state updaters, and precise scoping language. Revision 2 incorporated an integration-level review: raw-body handling for the sink, sink status semantics, exact test-delivery correlation, the honest delivery guarantee, held deliveries for disabled subscriptions, the event/audit matrix, the service graph, resource scoping, end-to-end request ids, cache generations, `useAsync` key changes, cache/optimistic coherence, compound cursors, Mongo-level claim atomicity, failure durations, redelivery budgets, and a deterministic seed.

Each section records the decision, the alternatives considered, and why they lost. Where a decision changes an earlier spec section, the change is stated in §10.

## 0. Why these, and not others

The guidelines reward depth over breadth: "the richness of the application should be reflected in the engineering decisions, system behavior, trade-offs, and failure modes covered by its features". The review found the backend already covers indexing, idempotency, optimistic concurrency, RBAC/ABAC, JWT, audit logging, background jobs, health checks, and cursor pagination, while three areas were thin:

1. **Observability** — six bare `console.*` calls, no request correlation, no way for a user to reference a failed request.
2. **Traffic and failure handling** — no rate limiting; retries and dead-lettering exist only implicitly in the rollout ticker.
3. **Frontend engineering** — no error boundaries, no code splitting, no optimistic updates, no client cache or request deduplication, and component tests limited to the router.

Everything chosen closes one of those gaps with behaviour a reviewer can *see* in the running product. Rejected outright: Redis, message brokers, CQRS, SSR/RSC, PWA/offline, module federation, virtualization. Each would either violate the dependency freeze, fail in the sandbox, or be bolted on without a workflow that needs it (guideline 6).

The one new subsystem is outbound webhooks. Every real flag platform has them, they are motivated by the existing audit stream, and a single feature exercises asynchronous processing, a database-backed job queue, retries with backoff, dead-letter handling, idempotent consumers, signed payloads, a circuit breaker, and cursor pagination — with visible failure modes.

## 1. Structured logging and request correlation

**Decision.** One logger module writes newline-delimited JSON to stdout: `{"ts","level","event",…fields}`, level from `LOG_LEVEL` (`debug|info|warn|error`, default `info`). A request-context middleware is the **first** middleware after `cors` — before any body parser — so every `/api` request, including one whose body fails to parse or exceeds the size limit, gets an id: the client's `X-Request-Id` when it matches `^[A-Za-z0-9_-]{8,64}$`, otherwise `crypto.randomUUID()`. The id is echoed in the response header, added to every error envelope as `error.requestId`, and one `http.request` line is written on `finish` with `requestId, method, path, status, durationMs, accountId?, profileId?`. 5xx errors also write an `http.error` line with the stack. `cors` exposes `X-Request-Id`, `RateLimit-*` and `Retry-After` so the browser can read them.

The frontend generates a `crypto.randomUUID()` per request, sends it as `X-Request-Id`, reads the echoed header from the response (falling back to `error.requestId` in the body), stores it on `ApiError.requestId`, and `ErrorBanner` renders "Reference: <id>" for `status ≥ 500` so a user can quote it.

All runtime `console.*` calls are replaced; the seed script keeps human-readable console output because it is an interactive CLI (stated in the README).

**Alternatives.** *pino/winston* — not allowed. *AsyncLocalStorage* — every log site already has `request` in scope. *Logging 4xx at warn* — the access line carries the status; 4xx are user behaviour. *Sampling* — no volume to justify it.

## 2. Rate limiting

**Decision.** A fixed-window in-memory limiter `createRateLimiter({ name, windowMs, max, keyFor })` on three routes: `POST /auth/login` (10 per 15 min per `ip + lowercased email`), `POST /projects/:key/evaluate` (60 per minute per profile), and `POST /webhook-sink/:token` (120 per minute per token). Responses carry `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`; rejections are `429 RATE_LIMITED` with `Retry-After` and `details.retryAfterSeconds`. The frontend shows a countdown on the login and Evaluate buttons. The store is a `Map` swept lazily above 1 000 keys.

**Alternatives.** *Token bucket / sliding log* — harder to explain and to test deterministically; the boundary burst is acceptable at these limits. *Global per-account limit* — a wrong number would throttle a reviewer. *Redis store* — not allowed; the store is the only piece a shared deployment would swap.

## 3. Error boundaries

**Decision.** One class component `ErrorBoundary` with a render-prop fallback and `resetKeys`. A shell-level instance in `App.jsx` (full-page fallback, "Reload Rheostat") and a route-level instance around `RouteSwitch` in `Workspace.jsx` (`resetKeys = [route.path]`; fallback offers "Try again" and a dashboard link). Errors go to the frontend logger (console, structured) — the browser console is the frontend's log sink. `EmptyState` gains an optional `id` prop so the fallback's heading can be referenced by `aria-labelledby`.

**Alternatives.** *Posting client errors to the backend* — a public write route with rate limiting and storage for no value in a single-user demo. *react-error-boundary* — not allowed. *Per-widget boundaries* — a failing dialog should fail its page visibly.

**Testing.** `renderToStaticMarkup` cannot exercise `componentDidCatch`; the static `getDerivedStateFromError` and both fallback components are unit-tested, and the catch is verified in the browser gate by temporarily throwing from a page and reverting.

## 4. Code splitting

**Decision.** Every routed page is loaded with `React.lazy` inside one `Suspense` (fallback `Skeleton`), the boundary from §3 outside the `Suspense` so a chunk-load failure is caught. `vite.config.js` sets `manualChunks: { react: ["react", "react-dom"] }` so the vendor chunk hash is stable. **Verification is behavioural, not structural**: routed modules are lazy (no page module referenced statically from the shell), the entry chunk shrinks versus the pre-split build, a page's module is not requested before navigation, and revisiting a loaded route requests no chunk. Rollup may factor shared modules however it likes.

## 5. Optimistic updates

**Decision.** Three interactions update the UI before the server answers and roll back on failure with a toast: change-request comment post (appears dimmed, "Posting…"), rollout pause/resume from `paused` (status flips), kill-switch clear (banner disappears). Each captures the previous value before `mutate(optimistic)` and restores it in `catch`. Not optimistic: targeting save, change-request apply, resume from `stalled` — each can legitimately fail (`VERSION_CONFLICT`, `ROLLOUT_ACTIVE`, `ROLLOUT_INCOMPATIBLE`).

**Coherence with the cache (§6).** Policy: (1) optimistic values live in hook state only; (2) the authoritative server response is committed to the cache through `mutate(data, { commit: true })`, which writes the entry for the hook's key; (3) failure restores the previous hook state and leaves the cache untouched; (4) dependent lists are invalidated by prefix in the API module (e.g. a comment does not touch the flag list; a kill-switch clear invalidates `flags:<project>`). A navigation away and back after a successful optimistic mutation therefore shows the committed server value, never the optimistic guess.

## 6. Client cache and request deduplication

**Decision.** `shared/api/cache.js` holds a module-level cache with **generations**: `dedupe(key, loader)`, `readCache(key)`, `writeCache(key, data)`, `invalidate(prefix)`, `clearCache()`. `clearCache()` increments the generation; a `dedupe` call captures the generation at start and its result is written to the cache only if the generation is unchanged when it resolves, so a request started under profile A cannot populate profile B's cache. In-flight cleanup is identity-safe: a settled promise deletes its key only if the map still holds that same promise. `App.jsx` calls `clearCache()` on sign-out and profile switch.

`mutate(updater, { commit })` is **generation-aware and pure**: the hook keeps a `dataRef` mirror of the latest data, computes the next value outside React's state updater, ignores the call when the hook has since moved to another key, and — when committing an authoritative server value — bumps the hook's load generation so an older in-flight GET that resolves later is discarded rather than overwriting the committed state. Cache writes happen outside the updater.

`useAsync(loader, deps, { key, staleMs = 30000 })`: with a key it initialises from the cache (stale-while-revalidate — `data` present, `loading` false, `revalidating` true when older than `staleMs`) and dedupes concurrent loads. **Key changes while mounted** are handled explicitly: the hook tracks the last key in a ref and, when the key changes, resets state synchronously to the cached value for the new key (or to `loading` with no data), then loads. Pure helpers (`initialStateFor(key, staleMs)`, `settle(previous, result)`) are unit-tested; the hook's effect ordering is verified in the browser. Keys: `projects`, `profiles`, `segments:<project>`, `people:<query>`, `flags:<project>:<filters>`, `webhooks:<project>`. API modules invalidate the prefixes they mutate.

**Alternatives.** *Automatic URL cache* — implicit and wrong invalidation. *ETags* — server work for no gain on loopback. *localStorage* — cross-profile leakage.

## 7. Component tests without a DOM

**Decision.** Component tests render with `react-dom/server`'s `renderToStaticMarkup` and assert on markup and text; files sit beside the component as `*.test.jsx`. Hooks and effects are covered by pure helpers plus browser gates.

**Alternatives.** *happy-dom / jsdom* — forbidden by the freeze. *No component tests* — leaves the frontend at "router only".

## 8. README engineering notes

**Decision.** A concept → location → trade-off table, the delivery-guarantee statement from §9.4, and a "what a multi-process deployment would change" paragraph.

## 9. Outbound webhooks

### 9.1 Purpose and users

Release managers and admins connect Rheostat to tools that need to know when configuration changes. Everyone can read subscriptions and delivery history. The built-in **test receiver** ("sink") lets any user verify a subscription end to end without internet access.

### 9.2 Event catalogue and the emission matrix

Payload envelope: `{ id, event, occurredAt, project: { key, name }, environment?, flag?: { key, name }, data }`.

| Mutation | Owning audit entry (written first) | `flag.config.updated` | Domain event | Emitter |
|---|---|---|---|---|
| Direct targeting save | `flag.config.updated` (by `writeVersion`) | yes (`source: "direct"`) | — | `flagService.writeVersion` after its own audit |
| Promotion (direct, unprotected target) | `flag.promoted` (by `writeVersion` from the governance descriptor) | yes (`source: "promotion"`) | — | `writeVersion` |
| Rollback (direct) | `flag.rolledBack` (by `writeVersion`) | yes (`source: "rollback"`) | — | `writeVersion` |
| Change-request apply | `changeRequest.applied` (by `changeRequestService.apply`; `writeVersion` is called with `audit: false`) | yes (`source: "changeRequest"`) | `changeRequest.applied` | `changeRequestService.apply`, both after its audit |
| Kill switch activate | `flag.killSwitch.activated` | no (no version bump) | `flag.killSwitch.activated` | `flagService` |
| Kill switch clear | `flag.killSwitch.cleared` | no | `flag.killSwitch.cleared` | `flagService` |
| Archive / restore | `flag.archived` / `flag.restored` | no | `flag.archived` / `flag.restored` | `flagService` |
| Metadata edit | `flag.metadataUpdated` | no | none | — |
| Rollout step applied | `rollout.stepApplied` (`recordOnce`) | yes (`source: "rollout"`, id `rollout:<plan>:<step>:config`) | `rollout.stepApplied` (id `rollout:<plan>:<step>:applied`) | reconciler `finalize` after `audit.recordOnce` |
| Rollout stalled | `rollout.stalled` (`recordOnce`) | no | `rollout.stalled` (id `rollout:<plan>:stalled:<version>`) | reconciler `stall` |
| Rollout completed | `rollout.completed` (`recordOnce`) | no | `rollout.completed` (id `rollout:<plan>:completed`) | reconciler `finalize` |
| Rollout aborted | `rollout.aborted` | no | `rollout.aborted` | `rolloutService.abort` |
| Rollout created / paused / resumed | `rollout.*` | no | none (no configuration change) | — |
| Change-request create / review / rebase / withdraw / comment | `changeRequest.*` | no | none | — |
| Webhook test | — | no | `webhook.test` | `webhookService.test` |

**Ownership rule.** `writeVersion` emits `flag.config.updated` **only when it also writes the audit entry** (an audit descriptor was passed). With `audit: false` the caller owns both the audit entry and the emissions, so a change-request apply produces exactly one `flag.config.updated` and one `changeRequest.applied`, both after `changeRequest.applied` is recorded. **Every business event has a deterministic id derived from its domain identity**, so a retried or replayed logical event maps onto the same `(subscriptionId, eventId)` row and the unique index rejects the duplicate: `flag.config.updated` → `flag:<flagId>:<env>:v<version>:config`; `changeRequest.applied` → `cr:<changeRequestId>:applied`; rollout events → `rollout:<planId>:<stepId>:applied|config`, `rollout:<planId>:completed`, `rollout:<planId>:stalled:v<version>`, `rollout:<planId>:aborted`; kill switch, archive and restore (state transitions without a version) → `audit:<auditEntryId>` of the owning audit entry, which is the durable record of that transition and is created exactly once per transition. Only `webhook.test` uses a random id, because each test is a distinct user action by design.

### 9.3 Delivery guarantee (honest statement)

**Enqueue is best-effort and independently logged; delivery is at-least-once after a successful enqueue.** The owning operation (a targeting save, a kill switch) succeeds even if inserting its deliveries fails — a webhook problem must not block a release action — and the failure is logged as `webhook.emit.failed` with the event id. Enqueue success is decided by the insert alone; the immediate dispatch kick that follows is best-effort, fire-and-forget, and logged separately as `webhook.dispatch.kick.failed` — the 5-second ticker picks up anything the kick missed. Once a delivery row exists, the worker retries on the schedule until delivered or dead-lettered; a crash between the receiver accepting and Rheostat recording re-sends, so receivers must dedupe on `X-Rheostat-Delivery`. The sink demonstrates that by flagging duplicates. An outbox that makes enqueue transactional with the audit write is out of scope and named as such in the README.

### 9.4 Data model

**WebhookSubscription** — `projectId, name (≤ 80), url (absolute http(s), ≤ 500), secret (32 random bytes hex), events[] (non-empty subset of the catalogue), environments[] (empty = all), enabled, disabledReason ∈ {null, "AUTO_FAILURES", "MANUAL"}, consecutiveFailures, lastDeliveryAt, lastDeliveryStatus, createdBy`. Index `{ projectId: 1, createdAt: -1 }`. The secret is returned once on create and once on rotation; reads return `secretHint` (last 4 characters).

**WebhookDelivery** — `subscriptionId, projectId, eventId, event, payload, status ∈ {pending, held, delivering, delivered, dead}, attempts[{ at, outcome ∈ {delivered, failed}, durationMs, responseStatus?, responseSnippet? (≤ 500), error? }], budgetFrom (index into attempts where the current retry budget starts; 0 initially), nextAttemptAt, claimedAt, deliveredAt, createdAt`. Indexes: `{ subscriptionId: 1, eventId: 1 }` unique; `{ status: 1, nextAttemptAt: 1 }`; `{ subscriptionId: 1, createdAt: -1, _id: -1 }`; `{ projectId: 1, status: 1 }`.

`held` is the state of deliveries whose subscription is disabled: disabling a subscription moves its `pending` deliveries to `held`; enabling moves them back to `pending` with `nextAttemptAt = now`. Fan-out never creates deliveries for a disabled subscription. The worker claims only `pending` rows **whose subscription is not in the disabled set** (computed once per pass and passed to the claim query as `$nin`), and if a race still hands it a pending row of a disabled subscription it converts that subscription's entire pending backlog to `held` in one write. A disabled backlog can therefore cost at most one claim per disabled subscription per pass and can never starve enabled subscriptions.

**WebhookReceipt** — the sink's inbox, one document per logical delivery: `projectId, subscriptionId?, dedupeKey, deliveryId, event, firstReceivedAt, lastReceivedAt, receivedCount, headers (the X-Rheostat-* set), body (≤ 16 kB), signatureValid, signatureError`. **Unique index `{ projectId: 1, dedupeKey: 1 }`**; `dedupeKey` is the delivery id for a valid signature and `invalid:<uuid>` otherwise, so invalid attempts are always recorded individually. Duplicate detection is a single atomic upsert (`findOneAndUpdate` with `$setOnInsert` for the first receipt and `$inc: { receivedCount: 1 }`), so two concurrent identical requests produce one document with `receivedCount: 2` — never two `duplicate: false` rows. Capped at 50 per project. Index `{ projectId: 1, lastReceivedAt: -1 }`.

**Project** gains `webhookSink: { token }` (16 random bytes hex; fixed values in the seed). The sink URL is `${API_ORIGIN}/api/v1/webhook-sink/<token>` where `API_ORIGIN` is a backend env with default `http://localhost:8000`; it is reported by the list endpoint so the UI never guesses.

**Decision: queue in Mongo.** Survives restarts, inspectable, replayable; `findOneAndUpdate` gives atomic claims for a single worker.

### 9.5 Delivery worker (`features/webhooks/dispatch.js`, pure with injected deps)

`createDispatcher({ deliveries, subscriptions, send, audit, log, clock, staleClaimMs = 60000, maxPerPass = 20 })` → `{ dispatchDue(now), dispatchOne(deliveryId, now) }`. Automated audit entries (`webhook.deliveryDead`, `webhook.autoDisabled`) are written with the **system actor** (§9.14), never with the subscription creator's identity.

`dispatchDue(now)`, every 5 s and after each enqueue:

1. **Recovery** — `delivering` rows with `claimedAt < now − 60 s` are released to `pending`.
2. **Claim** — `disabled = subscriptions.findDisabledIds()` once per pass; `deliveries.claimNext(now, disabled)` performs `findOneAndUpdate({ status: "pending", nextAttemptAt: { $lte: now }, subscriptionId: { $nin: disabled } }, { $set: { status: "delivering", claimedAt: now } }, { sort: { nextAttemptAt: 1 } })`; at most `maxPerPass` claims per pass. A row claimed for a subscription that was disabled after the set was computed is not sent: the whole backlog of that subscription is moved to `held` with one `holdPending` write and the pass continues.
3. **Send** — `POST url` with `Content-Type: application/json`, `User-Agent: Rheostat-Webhooks/1`, `X-Rheostat-Event`, `X-Rheostat-Delivery`, `X-Rheostat-Subscription`, `X-Rheostat-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`; 5 s timeout. The dispatcher measures elapsed time around `send` with its injected `clock`, so a timeout or connection error records its **real** duration.
4. **Outcome** — 2xx → `delivered`, subscription `consecutiveFailures = 0`. Otherwise the attempt is appended; `budgetUsed = attempts.length − budgetFrom`; if `budgetUsed < MAX_ATTEMPTS (5)` → `pending` with `nextAttemptAt = now + BACKOFF_MS[budgetUsed]` where `BACKOFF_MS = [0, 30 000, 120 000, 300 000, 900 000]`; else `dead`, `consecutiveFailures += 1`, audit `webhook.deliveryDead`.
5. **Breaker** — at `consecutiveFailures ≥ 5` the subscription becomes `enabled: false, disabledReason: "AUTO_FAILURES"`, its pending deliveries move to `held`, audit `webhook.autoDisabled`. Re-enabling (manual) resets the counter and releases held rows.

`dispatchOne(id, now)` claims exactly that row (`claimById`) and runs the same send/outcome logic; it is used by the test-ping and redeliver operations so their result is the delivery they created, never "the latest row".

**Manual redelivery** starts a **fresh retry budget while preserving history**: `budgetFrom = attempts.length`, `status = pending`, `nextAttemptAt = now`. The timeline shows every attempt; the retry count and backoff index restart from the redelivery.

**Decision: table backoff.** One worker, no thundering herd; a table is explainable and testable.

### 9.6 Sink (`POST /api/v1/webhook-sink/:token`)

Mounted **before** the global JSON parser with `express.raw({ type: "*/*", limit: "16kb" })`, so it receives the exact bytes the sender signed; the request-context middleware runs before it. Rate-limited 120/min per token. **Binding invariant, checked before any signature work:** the subscription named by `X-Rheostat-Subscription` must belong to the project that owns the sink token (`String(subscription.projectId) === String(project._id)`); otherwise the request is treated as an unknown subscription. Behaviour:

| Condition | Response | Receipt |
|---|---|---|
| Unknown token | 404 `SINK_NOT_FOUND` | none |
| Missing/unknown `X-Rheostat-Subscription`, or a subscription of another project | 401 `SIGNATURE_INVALID` (`details.reason: "unknown subscription"`) | stored, `signatureValid: false` |
| Malformed / expired (> 300 s) / mismatched signature | 401 `SIGNATURE_INVALID` (`details.reason`) | stored, `signatureValid: false` |
| Valid, first time | 204 | stored, `signatureValid: true, duplicate: false` |
| Valid, `X-Rheostat-Delivery` already seen | 204 | same document, `receivedCount` incremented atomically |
| Body > 16 kB | 413 `PAYLOAD_TOO_LARGE` (from the raw parser) | none |

Because invalid signatures are non-2xx, the dispatcher retries and eventually dead-letters them — the same thing a real receiver would cause. The Inbox and the delivery history therefore agree.

**Demonstrating a signature failure.** The sender and the sink read the same stored secret, so rotating or editing the secret cannot produce a mismatch between them — that demo was logically impossible and is removed. The failure path is demonstrated with a hand-made request: `curl` to the sink with a valid `X-Rheostat-Subscription` and a wrong `X-Rheostat-Signature` (401, Inbox shows *Invalid: mismatch*), and with a stale `t=` (401, *Invalid: expired*). The automated sink tests cover every row of the table.

### 9.7 Authorization and resource-relationship integrity

`webhook:read` — everyone. `webhook:manage` — admin and release manager. Rheostat's authorization model is **account-wide by design**: every profile can read every project and roles are workspace-wide (original spec §11 lists per-project membership as out of scope). The tests therefore do **not** claim a per-project authorization boundary. What they prove is **resource-relationship integrity**: list, receipts and stats endpoints return only the URL project's data; resource-by-id routes (`/webhooks/:id`, `/deliveries/:id`) derive their project from the stored resource, never from client input; a delivery is reachable only through its own subscription's history; and the sink binds subscription to project (§9.6). A fabricated or mismatched relationship (a Project A token with a Project B subscription, a delivery id under the wrong subscription) is rejected — that is the guarantee, and it is worded that way in the README.

### 9.8 API

| Route | Purpose | Permission |
|---|---|---|
| GET `/projects/:projectKey/webhooks` | subscriptions with counts (`delivered`, `dead`, `pending` (+held), `held`), `sinkUrl`, `totals.dead`, `permissions.canManage` | `webhook:read` |
| POST `/projects/:projectKey/webhooks` | create; 201 with `secret` once | `webhook:manage` |
| GET `/projects/:projectKey/webhooks/sink/receipts` | last 50 receipts | `webhook:read` |
| DELETE `/projects/:projectKey/webhooks/sink/receipts` | clear the inbox → 204 | `webhook:manage` |
| GET `/webhooks/:id` | detail with `secretHint` | `webhook:read` |
| PATCH `/webhooks/:id` | name, url, events, environments, enabled, `rotateSecret` (returns `secret` once) | `webhook:manage` |
| DELETE `/webhooks/:id` | delete with deliveries → 204 | `webhook:manage` |
| GET `/webhooks/:id/deliveries?status=&cursor=&limit=` | history, compound cursor `(createdAt, _id)`; response `{ items, nextCursor }` | `webhook:read` |
| POST `/webhooks/:id/test` | enqueue one `webhook.test` delivery for this subscription, dispatch it, return **that** delivery; 422 `WEBHOOK_DISABLED` when disabled | `webhook:manage` |
| GET `/deliveries/:id` | delivery with attempts, payload, headers sent | `webhook:read` |
| POST `/deliveries/:id/redeliver` | fresh budget, immediate attempt, returns the delivery; 422 when `delivering` or `held` | `webhook:manage` |
| POST `/webhook-sink/:token` | the receiver (§9.6) | none, rate-limited |

Cursor: opaque string `<createdAt ISO>_<id>`; predicate `{ $or: [{ createdAt: { $lt: t } }, { createdAt: t, _id: { $lt: id } }] }` with sort `{ createdAt: -1, _id: -1 }`.

### 9.9 Service graph change

```text
governance → change-requests, rollouts, flags, segments, projects
change-requests → rollouts, flags, projects, evaluation, segments
rollouts → flags, projects
segments → flags
evaluation → flags, segments, projects
dashboard → flags, change-requests, rollouts, evaluation, projects, webhooks (stats only)
webhooks → projects, audit
audit ← everyone
webhooks/events.js (enqueue/emit only) ← flags, change-requests, rollouts
```

`webhook.service.js` imports `auditService` for its own audit entries; that edge is declared. Nothing in `webhooks` imports flags, change requests or rollouts. `flag.service.js` gains `flags → projects` (already allowed) to build the event payload's project block.

### 9.10 Testability decisions

- `createWebhookService(deps)` builds the service from injected repositories, the dispatcher, the audit service, a project lookup, `clock`, and `apiOrigin`; the default export is built from the real modules. Controllers are built by `createWebhookRouters(service)`; `app.js` uses the defaults. HTTP tests mount the real routers on a bare Express app with fake repositories and a stub auth middleware that sets `request.profile`, and exercise real requests over loopback — status codes, Zod envelopes, role authorization, scoping, secret-once/hidden, rotation, test delivery, cursor pagination, redelivery.
- `createSinkRouter(deps)` likewise; its tests send real HTTP requests with bodies signed against the exact bytes, including the > 16 kB case, the cross-project binding case (Project A token, Project B subscription, valid Project B signature → 401), and concurrent duplicate submissions resolving to one receipt with `receivedCount: 2`.
- The pure dispatcher tests (fakes) prove the worker's logic. They **do not** prove Mongo atomicity. A separate opt-in integration suite (`*.integration.test.js`, skipped unless `MONGODB_TEST_URI` is set) proves with a real database: two concurrent `claimNext()` calls yield one claimant; the unique `(subscriptionId, eventId)` index dedupes; the compound cursor pages correctly when several rows share `createdAt`. The phase gate runs it with `MONGODB_TEST_URI=mongodb://localhost:27017/rheostat_test`.

### 9.11 Frontend

- **Settings → Webhooks tab** (`?tab=webhooks`): sink card (URL, copy, Clear inbox), subscriptions table (name → detail, host, events, environments, status pill Enabled / Disabled / Auto-disabled, delivered / dead / held counts, last delivery), "New webhook" dialog (name, URL, "Use the built-in test receiver", event checkbox groups, environment chips; one-time secret panel on success), row actions Test / Enable / Disable / Delete; Inbox below.
- **Webhook detail** `/projects/:projectKey/webhooks/:id`: status, breaker banner, actions (Test, Enable/Disable, Edit, Rotate secret, Delete), deliveries list with status filter and "Load more" (cursor), delivery drawer (attempt timeline with real durations and "Next attempt", payload, headers, Redeliver).
- **Inbox**: receipts with signature badge Valid / Invalid: reason / Duplicate.
- **Dashboard**: "Dead-lettered deliveries" tile.
- Every list has skeleton, empty, and error states; 375 px without horizontal overflow; every control labelled.

### 9.12 Seed (deterministic)

Fixed fixtures, not derived from the audit stream at seed time:

- Storefront "Deploy notifier" → sink, all events, enabled: **8 delivered** deliveries (events chosen from the seeded history: kill switch on/off for `pricing-banner`, promotions of `new-checkout` and `biometric-login`-style entries as listed in the seeder, `changeRequest.applied` for `biometric-login`, rollout steps for `new-checkout`) each with a matching **receipt** (8).
- Storefront "Legacy pager (decommissioned host)" → `http://127.0.0.1:9/hooks`, kill-switch and `rollout.stalled` events, production only, `consecutiveFailures: 3`, enabled: **3 dead** deliveries, five attempts each on the backoff table.
- Mobile "Release channel" → sink, rollout events: **3 delivered** deliveries with **3 receipts**.

Asserted counts: **3 subscriptions, 14 deliveries (11 delivered, 3 dead, 0 pending/held), 11 receipts**; audit gains 3 `webhook.created` + 3 `webhook.deliveryDead` = 6 entries (108 → 114 with the rollout seed already in place).

### 9.13 Failure modes made visible

| Situation | Observable behaviour |
|---|---|
| Receiver down | attempts on the schedule with real durations; dead after the fifth; counter climbs |
| Receiver flaps | delivered resets the counter; the breaker trips only on consecutive dead deliveries |
| Receiver slow | 5 s timeout recorded with its elapsed time, retried |
| Wrong signature (hand-made request) | sink 401; Inbox *Invalid: mismatch* |
| Stale timestamp | sink 401; Inbox *Invalid: expired* |
| Restart mid-delivery | stale claim released within 60 s; a re-send increments the receipt's `receivedCount` (shown as ×2 in the Inbox) |
| Sink token and subscription from different projects | 401 `SIGNATURE_INVALID` (unknown subscription); receipt stored as invalid |
| Dispatch kick fails after a successful insert | `webhook.dispatch.kick.failed` logged; the ticker delivers within 5 s |
| Five consecutive dead | auto-disabled, pending → held, banner; enable → held → pending, counter reset |
| Enqueue failure | operation succeeds; `webhook.emit.failed` log line with the event id |

### 9.14 System actor for automated audit entries

`AuditEntry` gains `actorKind ∈ {"user", "system"}` (default `user`). Automated writers use `SYSTEM_ACTOR = { _id: ObjectId("000000000000000000000001"), name: "Rheostat" }` with `actorKind: "system"`: the webhook worker's `webhook.deliveryDead` and `webhook.autoDisabled`. Rollout steps keep `actorId = plan.createdBy` as the original spec §4.6 requires (the step runs on that person's authority) but are marked `actorKind: "system"` so the audit page can label them "automated". `personService.attachActors` returns `{ _id, name: "Rheostat", system: true }` for the sentinel id, and the audit UI renders a distinct "Automated" badge whenever `actorKind === "system"`. No person document is seeded for the sentinel; it is a constant.

## 10. Changes to earlier spec sections

- §3.2: add `webhook:read` (everyone) and `webhook:manage` (release manager, admin).
- §4.11 AuditEntry: add `actorKind` and the system actor (§9.14).
- §4.3 Project: add `webhookSink.token`.
- §5.13: graph as in §9.9.
- §6 API: routes in §9.8; `429 RATE_LIMITED` on login, evaluate, sink; every error envelope carries `requestId`.
- §7.2 shell: route-level error boundary; `/projects/:projectKey/webhooks/:id`; Settings gains a Webhooks tab.
- §7.4 dashboard payload: add `webhooks: { deadDeliveries, subscriptions }`.
- §7.5: pages lazy-loaded; `ErrorBanner` shows the request reference for 5xx.
- §8 seed: §9.12 and the sink tokens.
- §9 README: engineering notes, the delivery-guarantee statement, the multi-process paragraph.
- §10 testing: component render tests; dispatcher/signature/fan-out/service/HTTP/sink suites; opt-in Mongo integration suite.

## 10a. Positioning against the updated team guidelines

The updated guidelines ask proposers to look beyond crowded domains (retail, inventory, ticketing, incident response, **API developer tooling**, …) and encourage in-product agentic workflows. Rheostat is release governance and progressive delivery — the workflow between a code change and its exposure to users — not an API-tooling product, and the README states that positioning explicitly (users: developers, reviewers, release managers, admins; problem: shipping changes safely with review, gradual exposure, and instant rollback). No agent integration is added in this plan: the review that produced revision 3 asked for no broadening, and the remaining budget goes to the guarantees above. A later, separate proposal could add an in-product "release assistant" that drafts rollout plans and change-request descriptions from history; it is recorded here as future work, not scope.

## 11. Out of scope (added)

Inbound webhooks, per-subscription rate limits, payload templating, replay from the audit log, transactional outbox, SSE/live updates, client-error reporting endpoint, global per-account throttling, SSRF egress allow-list, independent receiver-side secret simulation.
