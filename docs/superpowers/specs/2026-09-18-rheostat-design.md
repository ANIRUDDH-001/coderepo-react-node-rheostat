# Rheostat — Design Specification

Date: 2026-09-18
Status: approved for implementation planning
Repository: `coderepo-react-node-rheostat` (React + Node + MongoDB, built on the HackerRank reference calendar contract)

## 1. Product identity

**Rheostat** is a feature-flag and progressive-delivery platform for a single engineering organization. Teams define flags per project, target them with rules and reusable segments per environment, ramp them out on a schedule, and gate production changes behind reviewed change requests, with a complete and reversible history of every configuration change.

The name is the metaphor: a rheostat varies current gradually instead of switching it on or off.

Primary user types: developers who create and target flags, reviewers who approve production changes, release managers who run rollouts and hold the kill switch, admins who own project and environment policy, and viewers (product, support) who need to understand what is live and why.

Main workflow: create a flag → target it in development/staging → propose a production change → review and apply → ramp progressively → observe → clean up when it is fully rolled out.

## 2. Binding constraints (from the acceptance contract)

- Stack is frozen to the reference: React 19, Vite 8, Express 5, Mongoose 8, Zod 4, jsonwebtoken, bcryptjs, cors, dotenv, concurrently, @fontsource/roboto. Bun workspace with one root `package.json` and one `bun.lock`. No new dependency of any kind.
- Frontend on port 3000, backend on 8000, MongoDB on 127.0.0.1:27017. `hackerrank.yml` install `bun install && bash setup.sh --seed`, run `bun start`. Start resets the database to the seeded baseline.
- No WebSockets, uploads, email, external services, external media, or multiple simultaneous browser sessions. Multi-user behavior is demonstrated by one sign-in switching between seeded profiles.
- Feature-oriented layout: `backend/src/features/<domain>/{*.routes,*.controller,*.service,*.repository,*.model}.js`, `backend/src/shared/`, `frontend/src/features/<domain>/`, `frontend/src/shared/`. Request flow `route → controller (Zod) → service (rules) → repository (Mongoose)`.
- Every public backend product route must have a reachable frontend consumer; every frontend interaction must call a real route with MongoDB persistence. Health is the only operational exemption.
- Preserve the reference design system (CSS custom-property tokens, dark/light themes, `<dialog>` modals, inline SVG icons, Roboto), Prettier and editorconfig settings, `{ data }` / `{ error: { code, message, details } }` response envelopes, and the `AppError` pattern.
- Only permitted additions to repository tooling: `test` scripts using Bun's built-in `bun test` (no dependency), and `.gitattributes` `export-ignore` entries for `GUIDELINES.md` and `skills/` as required by GUIDELINES §3.6.

## 3. Users, roles, and authorization

### 3.1 Session model

Identical to the reference: `WorkspaceAccount` sign-in (email + password) returns a workspace token; the profile picker calls `switch-profile` and returns a profile token carrying `profileId`. Every request re-reads the `Person` for `profileId`; the role is taken from that document, never from the token, so role changes apply immediately.

`GET /auth/session` returns `{ account, profile, permissions[] }` where `permissions` is the computed list of actions the active profile may perform. The frontend uses this list only to disable controls and explain why; the backend is the sole authority.

### 3.2 Roles and permission matrix

`backend/src/shared/auth/permissions.js` exports `PERMISSIONS` (action → roles) and `permissionsFor(role)`. Services call `assertCan(profile, action, context)`, which throws `AppError(403, "FORBIDDEN")`.

| Action | Viewer | Developer | Reviewer | Release Manager | Admin |
|---|---|---|---|---|---|
| `project:read`, `flag:read`, `segment:read`, `changeRequest:read`, `rollout:read`, `audit:read`, `dashboard:read`, `playground:evaluate`, `savedView:manageOwn` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `flag:create`, `flag:editMetadata`, `segment:manage`, `changeRequest:create`, `changeRequest:comment`, `changeRequest:editOwn`, `changeRequest:withdrawOwn` | | ✓ | ✓ | ✓ | ✓ |
| `flag:editConfig` (direct write, unprotected environments only) | | ✓ | ✓ | ✓ | ✓ |
| `rollout:manage` in unprotected environments | | ✓ | ✓ | ✓ | ✓ |
| `changeRequest:review` (never on own request) | | | ✓ | ✓ | ✓ |
| `changeRequest:apply` (author of an approved request, or these roles) | | author | author | ✓ | ✓ |
| `rollout:manage` in protected environments | | | | ✓ | ✓ |
| `flag:killSwitch` | | | | ✓ | ✓ |
| `flag:archive`, `flag:restore`, `changeRequest:withdrawAny` | | | | ✓ | ✓ |
| `project:manage` (create project, edit environment protection and approval policy), `people:manageRoles` | | | | | ✓ |

Environment rules that apply regardless of role:

- A write to a **protected** environment's configuration (edit, rollback, promotion) never happens directly; it is expressed as a change request and lands only through `changeRequest:apply`.
- A change request may be created for any environment (a developer may want review in staging); it is *required* for protected ones.
- Progressive rollouts in protected environments are scheduled directly by Release Managers and Admins. Every applied step still writes an audited `FlagVersion`. (Policy call approved during design; the alternative — a `rollout` change-request kind — is out of scope.)

  This is a deliberate, bounded exception to the change-request rule: **a protected-environment rollout is a privileged release operation that may change only the fallthrough allocation between existing variations.** It cannot modify targeting rules, clauses, the off variation, variation definitions, or any other configuration. The environment configuration must already be valid, enabled, and version-tracked before the rollout begins, and the plan's `baselineVariationId` must be the variation the fallthrough currently serves (see §5.4), so a rollout can only redistribute traffic between what is already live and what is being introduced. Any other production change goes through a change request.

### 3.3 Seeded people

| Person | Role | Headline |
|---|---|---|
| Priya Raman | Admin | Platform lead |
| Marcus Chen | Release Manager | Delivery engineering |
| Elena Novak | Reviewer | Staff engineer, storefront |
| Diego Alvarez | Developer | Storefront checkout |
| Sam Okafor | Viewer | Product manager |

Emails follow `first.last@rheostat.team`; every account's password is `password123`; every account may open any profile (mirrors the reference so the reviewer can exercise every role from one sign-in).

## 4. Domain model

All collections use `{ timestamps: true, versionKey: false }`. ObjectIds are validated with `mongoose.isValidObjectId` before lookups; invalid ids produce 404, not 500.

### 4.1 WorkspaceAccount

`name, email (unique, lowercase), passwordHash (select: false), allowedProfileIds[ObjectId → Person], active`.

### 4.2 Person

`name, email (unique), avatarColor, role ∈ {admin, releaseManager, reviewer, developer, viewer}, headline, isProfile, sortOrder`.

### 4.3 Project

`key (unique, immutable, /^[a-z][a-z0-9-]{1,39}$/), name, description, sortOrder, environments[]` where each environment is `{ key ∈ {development, staging, production}, name, color, protected: boolean, requiredApprovals: 1..3 }`. Environment keys are fixed at project creation and immutable; `protected` and `requiredApprovals` are editable by Admins.

Seeded projects: `storefront` (web storefront) and `mobile` (mobile app). Both have development, staging, and production; production is protected with `requiredApprovals: 1`.

### 4.4 Segment

`projectId, key (immutable), name, description, rules[Rule], includedKeys[string], excludedKeys[string]`. Unique index `{ projectId: 1, key: 1 }` — uniqueness is enforced by the database, not only by a service pre-check, so concurrent creates cannot produce two segments with the same key (the evaluator's `segmentsByKey` map depends on this). Rules are flat (no nested segments). A segment is project-scoped and reusable across every environment of that project.

### 4.5 Flag

```text
projectId, key (unique per project, immutable), name, description,
type ∈ {boolean, string, number, json},
variations[{ id (immutable, generated), name (editable), value (immutable, validated by type) }],
tags[string ≤ 10], ownerId → Person,
lifecycle { kind ∈ {temporary, permanent}, removeBy: Date | null },
archived: boolean, archivedAt, archivedBy,
killSwitch { active: boolean, reason, actorId, activatedAt },
environments: { development: EnvConfig, staging: EnvConfig, production: EnvConfig },
createdBy
```

Boolean flags have exactly two variations (`true`, `false`); other types have 2–8. Variations are append-only: a variation may be added or renamed, never removed or given a new value, so every historical `FlagVersion` and `EvaluationLog` stays resolvable.

**EnvConfig**

```text
version: integer ≥ 1 (optimistic concurrency token),
enabled: boolean,
offVariationId,
rules[{ id, description, clauses[Clause], serve: Serve }] (≤ 25),
fallthrough: Serve,
lastEffectiveChangeAt: Date,   # written only when a FlagVersion is created for this environment
lastChangedBy → Person
```

**Serve** is either `{ variationId }` or `{ rollout: { bucketBy: attributeName (default "key"), weights[{ variationId, weight }] } }` with weights summing to exactly 100000 (weights are hundred-thousandths, so 12.345% is expressible). This is the single stored representation of any split; rollout plans derive weights, they do not store a competing shape.

**Clause**: `{ attribute, operator, values[], negate }` with `operator ∈ {in, contains, startsWith, endsWith, greaterThan, lessThan, before, after, segmentMatch}`. For `segmentMatch`, `values` are segment keys of the same project. No regular-expression operator (ReDoS).

### 4.6 FlagVersion (immutable)

`flagId, projectId, environment, version, config (EnvConfig snapshot without lastChangedBy), actorId (required), reason, source ∈ {create, direct, changeRequest, rollback, rollout, promotion}, changeRequestId?, rolloutPlanId?, stepId?`. Unique index `(flagId, environment, version)`; unique sparse index `(rolloutPlanId, stepId)` so a rollout step can never produce two versions, which makes crash recovery (§5.5) idempotent.

Actor attribution for automated writes: a rollout step is recorded with `actorId = rolloutPlan.createdBy` and `source: rollout`, so history reads "Marcus Chen · Rollout step 25% · automated". No system pseudo-person exists and `actorId`/`lastChangedBy` are never null.

### 4.7 ChangeRequest

```text
projectId, flagId, environment,
kind ∈ {manual, promotion, rollback},
title, description,
proposedConfig: EnvConfig (without version/lastEffectiveChangeAt/lastChangedBy),
baseVersion: integer,               # target env version the proposal was made against
sourceEnvironment?, sourceVersion?, # promotion: env + version copied from; rollback: version restored
policy { requiredApprovals },       # snapshot at creation
status ∈ {pending, approved, conflicted, applied, rejected, withdrawn},
authorId,
reviews[{ reviewerId, decision ∈ {approve, reject}, comment, at }],
comments[{ id, authorId, body ≤ 2000, at }],
appliedVersion?, appliedAt?, appliedBy?, resolvedAt?
```

### 4.8 RolloutPlan

```text
projectId, flagId, environment,
targetVariationId, baselineVariationId, bucketBy,
steps[{ id, percent (0 < p ≤ 100, strictly increasing), startAt (strictly increasing),
        status ∈ {pending, applying, applied, skipped}, claimedAt?, appliedAt?, appliedVersion? }],
status ∈ {scheduled, running, paused, stalled, completed, aborted},
startedFromVersion,          # env version when the plan was created (rollback target offered on abort)
expectedVersion,             # env version the next step must find; updated to the version each step writes
lastAppliedStepId?, pausedAt?,
stallReason? ∈ {CONFIG_CHANGED_OUTSIDE_ROLLOUT, RECOVERY_AMBIGUOUS},
createdBy                    # also the actorId recorded on every automated step (§4.6)
```

At most one plan in `{scheduled, running, paused, stalled}` per flag × environment (enforced in the service with a guarded insert).

**Single source of truth.** A rollout plan never persists its own effective configuration. The hierarchy is strictly `RolloutPlan → derives weights → writes Flag.environments.<env> → snapshotted as FlagVersion`. The plan stores percentages and version pointers only; any "expected vs. observed" display is computed from the `FlagVersion` referenced by `steps[].appliedVersion` and the current config.

### 4.9 AudienceMember (synthetic audience)

`projectId, key, name, attributes { country, plan ∈ {free, pro, enterprise}, platform ∈ {web, ios, android}, appVersion (semver-like string), betaOptIn, signupDate (ISO date), company }`. 500 per project, generated from a seeded PRNG so the set is identical on every seed.

### 4.10 EvaluationLog

`projectId, flagId, flagKey, environment, contextKey, variationId, reasonKind, source ∈ {playground, simulated}, at`. Index `(projectId, at)` and `(flagId, environment, at)`.

### 4.11 AuditEntry

`projectId?, actorId, action (dotted, e.g. flag.killSwitch.activated), entityType, entityId, entityLabel, summary, metadata (small object), idempotencyKey? (unique sparse index), at`. Every mutating service writes exactly one entry per user-visible action (§5.13 defines which action owns it). `auditService.recordOnce(entry)` requires `idempotencyKey` and treats a duplicate-key error as success; it is used only by rollout step application and recovery.

### 4.12 SavedView

`ownerId, projectId, name, filters { query, environment, state ∈ {any, on, off}, tags[], type, lifecycle, stale ∈ {any, readyToRemove, overdue}, ownerId, archived }, sort`. Unique index `{ ownerId: 1, projectId: 1, name: 1 }` (409 `DUPLICATE_KEY` on collision).

## 5. Business rules (pure core, test-first)

These modules import nothing from Mongoose or Express. Each is covered by `bun test`.

### 5.1 Evaluator — `features/evaluation/evaluator.js`

`evaluate(flag, environmentKey, context, segmentsByKey) → { variationId, value, reason }`

Context: `{ key: string, attributes: { [name]: string | number | boolean } }`. `context.key` is also readable as attribute `key`.

Precedence, in order:

1. `flag.killSwitch.active` → `offVariationId`, reason `{ kind: "KILL_SWITCH" }`.
2. `!config.enabled` → `offVariationId`, reason `{ kind: "OFF" }`.
3. First rule whose clauses **all** match → that rule's serve, reason `{ kind: "RULE_MATCH", ruleId, ruleIndex, bucket? }`.
4. Fallthrough serve, reason `{ kind: "FALLTHROUGH", bucket? }`.

Explicit rules always take precedence over fallthrough bucketing. A rule's serve may itself be a rollout.

Clause semantics: `in` compares string forms of the attribute against each value; `contains/startsWith/endsWith` operate on strings; `greaterThan/lessThan` coerce both sides to numbers and fail closed on NaN; `before/after` parse ISO dates and fail closed on invalid input; `segmentMatch` is true if the context is a member of any listed segment; `negate` inverts the result of a clause whose attribute is present (a missing attribute never matches, negated or not).

Segment membership: `excludedKeys` wins → false; `includedKeys` → true; otherwise any segment rule whose clauses all match.

Bucketing: `bucket = parseInt(sha1(`${flag.key}.${environmentKey}.${value}`).slice(0, 8), 16) % 100000` where `value` is `context.attributes[bucketBy]` falling back to `context.key`. Walk `weights` cumulatively; the variation whose range contains `bucket` is served. `node:crypto` is a native platform API.

### 5.2 Config diff — `features/flags/config-diff.js`

`diffEnvConfig(before, after) → [{ path, kind ∈ {added, removed, changed}, before, after }]` over the normalized config (`enabled`, `offVariationId`, `rules` keyed by id with clause-level detail, `fallthrough`). Deterministic ordering. `isEquivalent(a, b)` is `diff.length === 0`. Used by change-request review, history, environment compare, and rollout drift detection.

### 5.3 Change-request transitions — `features/change-requests/transitions.js`

`transition(changeRequest, action, actor, now, context) → nextChangeRequest` (throws `AppError` on illegal moves).

| From | Action | Guard | To |
|---|---|---|---|
| — | create | author has `changeRequest:create` | `pending` |
| pending | review:approve | reviewer ≠ author, `changeRequest:review`, one review per reviewer | `pending`, or `approved` when approvals ≥ `policy.requiredApprovals` |
| pending | review:reject | as above | `rejected` |
| pending, approved, conflicted | edit | author | `pending` (reviews cleared, `baseVersion` = current) |
| approved | apply | author or apply role; `baseVersion === currentVersion` | `applied` |
| approved | apply | `baseVersion !== currentVersion` | `conflicted` |
| pending, approved (on read) | detect stale base | `baseVersion !== currentVersion` | `conflicted` |
| conflicted | rebase | author | `pending` (reviews cleared, `baseVersion` = current) |
| pending, approved, conflicted | withdraw | author, or `changeRequest:withdrawAny` | `withdrawn` |

`applied`, `rejected`, `withdrawn` are terminal. Comments are allowed in every state.

### 5.4 Rollout plans — `features/rollouts/plan.js`

- `validatePlan(plan, flag, config)`: target ≠ baseline, both are flag variations, steps non-empty, percents and `startAt` strictly increasing, config `enabled` at creation, and `baselineVariationId` equals the variation the current fallthrough serves — either a fixed `{ variationId }`, or, when the fallthrough is already a rollout, the plan must use that rollout's same target/baseline pair. This precondition is what confines a rollout to redistributing traffic between the live variation and the introduced one.
- `weightsForPercent(plan, percent)` → `[{ target, p×1000 }, { baseline, 100000 − p×1000 }, { every other variation, 0 }]`.
- `dueSteps(plan, now)` → pending steps with `startAt ≤ now`, in order.
- `shiftForResume(plan, now)` → pending steps moved forward by `now − pausedAt`.
- `compatibilityIssue(plan, config)` → `null` or a reason string (used on resume from `stalled`; see Semantics).

A step writes **only** `fallthrough` (and bumps `version`/`lastEffectiveChangeAt`). Drift is not detected structurally; it is detected by version (§5.5).

Semantics:

- **Pause**: future steps stop; live config untouched.
- **Resume** from `paused`: remaining steps continue from the shifted schedule. Resume from `stalled` (either reason): the operator is shown the diff between the config at `expectedVersion` and the current config; the service first runs `compatibilityIssue(plan, currentConfig)` — the environment must be `enabled` and its fallthrough must be a fixed variation in `{baselineVariationId, targetVariationId}` or a rollout whose non-zero weights cover only that pair. Any issue → `422 ROLLOUT_INCOMPATIBLE` with the reason ("Production now serves `v_legacy`, which is not part of this rollout"); the operator aborts or fixes the configuration first. Compatible → on confirmation the plan adopts the current version as `expectedVersion` and continues; the next step overwrites only `fallthrough`. No configuration is written by the resume itself. Creation keeps the stricter precondition above (baseline must equal the *currently served* variation); resume applies the pair-compatibility check because an outside change may legitimately have moved the percentage.
- **Abort**: terminal; live config untouched; remaining pending steps are marked `skipped`. The UI offers *Rollback to version N* (`startedFromVersion`) as a separate, auditable action.
- **Completed**: no pending steps remain, whatever the final percentage (a plan may deliberately stop at 50%).
- **Rollback** is never implicit.

### 5.5 Rollout reconciliation — `rolloutService.reconcileDue(now)`

Idempotent and safe to call concurrently. For each plan in `{scheduled, running}` with a due pending step:

1. Load the flag. If `killSwitch.active`, leave the step pending (UI shows "held by kill switch"). Kill-switch and metadata changes do not bump the environment version, so they never stall a plan; the hold is the only effect.
2. Claim the step: `findOneAndUpdate({ _id, "steps.id": stepId, "steps.status": "pending" }, { "steps.$.status": "applying" })`. Zero matches means another pass owns it; stop.
3. Write the environment config with the version guard: `findOneAndUpdate({ _id: flagId, "environments.<env>.version": plan.expectedVersion }, { $set: fallthrough = weightsForPercent(step), lastEffectiveChangeAt, lastChangedBy: plan.createdBy; $inc: version })`. This single guarded write is both the concurrency control and the drift check.
4. Zero matches → read the current version. If it differs from `plan.expectedVersion`, the configuration was changed outside the rollout: release the claim to `pending` and set the plan `stalled` with `stallReason: "CONFIG_CHANGED_OUTSIDE_ROLLOUT"` (audit `rollout.stalled`). If it is equal, another pass raced this one: release the claim and stop (retried next pass).
5. Success → insert `FlagVersion(source: rollout, rolloutPlanId, stepId)`, then `auditService.recordOnce` (`rollout.stepApplied`, `idempotencyKey = rollout:<planId>:<stepId>:applied`); mark the step `applied` with `appliedVersion`; set `plan.expectedVersion = appliedVersion` and `lastAppliedStepId`; set plan `running`, or `completed` when no pending steps remain.

`expectedVersion` is authoritative for drift. It is set to the environment's current version at plan creation, to the written version after each step, and to the current version on a confirmed resume from `stalled`.

**Crash recovery.** `applying` is a claim with a timestamp, not a terminal state. Before processing due steps, `reconcileDue(now)` looks for steps with `status: applying` and `claimedAt < now − 120 s` (a live pass finishes in milliseconds; two minutes is far beyond any legitimate claim) and resolves each one deterministically:

1. A `FlagVersion` with this `(rolloutPlanId, stepId)` exists → the write and the snapshot both happened; only the audit entry and/or finalization may be lost. Call `auditService.recordOnce` with `idempotencyKey = rollout:<planId>:<stepId>:applied` (a duplicate is a no-op), then mark the step `applied` with that version, set `expectedVersion` to it, and continue as in step 5 above.
2. No such version and the environment's current version equals `plan.expectedVersion` → the flag write never happened. Release the step to `pending`; it is applied normally in the same pass.
3. No such version, current version equals `plan.expectedVersion + 1`, and the current `fallthrough` is equivalent (§5.2) to `weightsForPercent(step)` with `enabled: true` → the flag write happened but the snapshot insert was lost. Insert the `FlagVersion` now (idempotent via the unique index), then finalize as in case 1 (which also makes the audit entry idempotent).
4. Anything else → `stalled` with `stallReason: RECOVERY_AMBIGUOUS`; the operator resolves it through the same resume-with-diff flow as drift, or aborts.

The single-process backend makes a stale claim rare (a crash between the claim and finalization), but the rule guarantees a plan can never strand with the flag already advanced.

Callers: a 30-second `setInterval` started in `backend/src/index.js` (cleared on shutdown), plan creation, and every rollouts list/detail read. There is no HTTP route for reconciliation.

### 5.6 Kill switch

Flag-level override, independent of environment configs. `activate(reason ≥ 10 chars)` requires `flag:killSwitch`, a confirmation dialog in the UI, and writes `AuditEntry(flag.killSwitch.activated)`. `clear()` writes `AuditEntry(flag.killSwitch.cleared)`. No `FlagVersion` is written because no configuration changed. While active: the evaluator short-circuits, a persistent banner shows on the flag, the flags list shows a badge, the dashboard lists it, and rollout steps are held.

### 5.7 Lifecycle and staleness — `features/flags/lifecycle.js`

`staleState(flag, now) → { readyToRemove: boolean, overdue: boolean, fullyRolledOut: boolean, lastEffectiveChangeAt }`.

- `fullyRolledOut`: every environment serves exactly one variation to everyone — `enabled === false`, or `enabled === true` with zero rules and a `{ variationId }` fallthrough.
- `readyToRemove`: `lifecycle.kind === "temporary"` ∧ `fullyRolledOut` ∧ `max(lastEffectiveChangeAt over envs) ≤ now − 14 days`.
- `overdue`: `lifecycle.kind === "temporary"` ∧ `removeBy < now`.

Metadata edits, comments, tags, and kill-switch changes never touch `lastEffectiveChangeAt`.

### 5.8 Promotion and rollback

- **Compare**: `GET .../environments/:env/compare?source=<env>` returns `diffEnvConfig(targetCurrent, normalize(sourceCurrent))` plus both versions.
- **Promote**: builds `proposedConfig = normalize(sourceCurrent)` (strips `version`, `lastEffectiveChangeAt`, `lastChangedBy`). Target protected → `ChangeRequest(kind: promotion, sourceEnvironment, sourceVersion)`; otherwise direct `FlagVersion(source: promotion)`.
- **Rollback**: `proposedConfig = FlagVersion(version).config`. Target protected → `ChangeRequest(kind: rollback, sourceVersion)`; otherwise direct `FlagVersion(source: rollback)`.

Segment references in a promoted config are validated against the project (segments are project-scoped, so they always resolve).

### 5.9 Impact preview (side-effect-free)

`POST .../environments/:env/impact { proposedConfig }` evaluates every `AudienceMember` of the project against the current and the proposed config and returns:

```text
{ audienceSize, before: { [variationId]: count }, after: { [variationId]: count },
  flipped: count, flippedSample: [{ key, name, attributes, before: { variationId, reason }, after: { variationId, reason } }] (≤ 20),
  attribution: { after: { [ruleId | "fallthrough" | "off" | "killSwitch"]: count } } }
```

Writes nothing. Used by the targeting editor before save and by change-request review.

### 5.10 Playground evaluation

`POST /projects/:projectKey/evaluate { environment, context, flagKeys? }` evaluates all active flags (or the listed ones) and returns `[{ flagKey, type, variationId, value, reason }]`. Writes one `EvaluationLog(source: playground)` per flag evaluated. The playground can load a seeded audience member as the context via `GET /projects/:projectKey/audience?search=&limit=`.

### 5.11 Audit

Every mutating service writes one `AuditEntry` and **awaits** it: the audit write is part of the operation, not a best-effort side effect. If the insert fails after the mutation succeeded, the request fails with `AUDIT_WRITE_FAILED` (500, operational) rather than silently returning success with a hole in the history. Standalone MongoDB offers no multi-document transaction, so this is the strongest guarantee available without one. Actions: `project.created/updated`, `person.roleChanged`, `flag.created/metadataUpdated/archived/restored`, `flag.config.updated` (direct), `flag.killSwitch.activated/cleared`, `flag.promoted`, `flag.rolledBack`, `segment.created/updated/deleted`, `changeRequest.created/edited/approved/rejected/applied/withdrawn/rebased/commented`, `rollout.created/stepApplied/paused/resumed/stalled/aborted/completed`, `savedView.created/updated/deleted`.

### 5.12 Active-rollout guard

A rollout and ordinary editing must not fight each other silently. While a plan for `flag × environment` is in `{scheduled, running, paused, stalled}`:

- Direct configuration edits, promotion into that environment, rollback of that environment, and **applying** a change request targeting it return `409 ROLLOUT_ACTIVE` unless the request carries `acknowledgeActiveRollout: true`. The UI presents this as a confirmation: "A rollout to 50% is active in production. Saving will stall it until an operator resumes or aborts it." The acknowledged write then proceeds, bumps the version, and the rollout stalls on its next pass exactly as §5.5 describes — the drift machinery stays intact and is reached deliberately.
- Exempt (no version bump, no conflict): kill switch activation/clearing (which *holds* the rollout instead, §5.5), metadata and variation edits, comments, and **creating** a change request. The guard runs at apply time, which is when the configuration actually changes.

### 5.13 Service dependency graph (acyclic)

Feature services may call other feature services in one direction only. `features/governance/` is the sole orchestration layer for configuration changes and is the only module that reaches into three features at once.

```text
governance  →  change-requests, rollouts, flags, segments, projects
change-requests  →  rollouts (active guard), flags (writeVersion), projects
rollouts  →  flags (applyRolloutStep, version insert), projects
segments  →  flags (countReferencingSegment)
evaluation  →  flags, segments, projects
dashboard  →  flags, change-requests, rollouts, evaluation, projects
audit  →  (nothing)      every mutating service  →  audit
people, projects, auth  →  (no feature dependencies beyond people ← auth)
```

Consequences: `flagService` is persistence and metadata only (create, list, detail, metadata patch, archive/restore, kill switch, version listing, the guarded config write); it never imports change-requests, rollouts, or segments.

**Environment mutation primitive.** `flagRepository.mutateEnvironment(flagId, envKey, expectedVersion, fields, actorId, now) → updatedFlag | null` is the **only** database write that changes an environment configuration: it matches on `environments.<env>.version === expectedVersion`, `$set`s the given fields (full config, or `fallthrough` only for rollout steps) plus `lastEffectiveChangeAt` and `lastChangedBy`, and `$inc`s the version. Two flows compose it:

- `flagService.writeVersion(flag, envKey, config, { actorId, source, reason, audit, changeRequestId?, expectedVersion })` — mutate → insert `FlagVersion` → **await** `auditService.record` when `audit` is a descriptor `{ action, summary, metadata }`; skip when `audit === false`. `audit` is a required parameter with no default, so no caller can accidentally produce a second entry.
- The rollout reconciler (§5.5) calls `mutateEnvironment` (fallthrough only), `flagVersionRepository.insert`, and `auditService.recordOnce` as separate steps so recovery can resume at any point.

**One audit entry per user action.** The outermost user action owns the audit entry: direct edit → `flag.config.updated` (via `writeVersion`); promotion → `flag.promoted`; rollback → `flag.rolledBack`; change-request apply → `writeVersion(..., audit: false)` plus exactly one `changeRequest.applied` with `metadata { flagKey, environment, appliedVersion }` (a version conflict on apply records `changeRequest.conflicted` and no version); rollout step → one `rollout.stepApplied` via `recordOnce`.

**Version 1 exists.** `flagService.create` inserts the flag and, in the same operation, one `FlagVersion(version: 1, source: create, reason: "Flag created", actorId: creator)` per environment, so every environment's history starts with a snapshot, "roll back to v1" is possible, and the v2 diff has a base. The seed does the same for every seeded flag. `validateEnvConfig(config, flag, segmentKeys)` receives segment keys from its caller. The flag detail's `activeRollout` is composed in the flag controller from `flagService.getByKey` and `rolloutService.activeForFlag`. Every configuration-changing HTTP entry point (`PATCH .../environments/:env`, `promote`, `rollback`, and change-request `apply`) goes through `governanceService` or `changeRequestService`, which apply protection, the active-rollout guard, and then call `flagService.writeVersion`.

## 6. API surface

Base path `/api/v1`. Envelopes and error shape as the reference. All routes except `/health` and `/auth/login` require a workspace token; all routes after `/profiles` require a profile token (`resolveProfileContext`). Pagination: `?page=1&pageSize=25` with `{ items, total, page, pageSize }` in `data` for lists that can grow (flags, change requests, audit, evaluation logs).

| Method & path | Purpose | Permission |
|---|---|---|
| GET `/health` | API + MongoDB status (`connected`/`disconnected`, 200/503) | none (operational) |
| POST `/auth/login`, GET `/auth/session`, POST `/auth/switch-profile`, POST `/auth/logout` | as reference; session adds `profile` and `permissions` | — |
| GET `/profiles` | seeded profiles for the picker | workspace token |
| GET `/people?search=` | owner/reviewer pickers | `flag:read` |
| PATCH `/people/:personId/role` | change a role | `people:manageRoles` |
| GET `/projects`, GET `/projects/:projectKey` | list / detail with environments | `project:read` |
| POST `/projects`, PATCH `/projects/:projectKey` | create; edit name/description/environment `protected`/`requiredApprovals` | `project:manage` |
| GET `/projects/:projectKey/flags` | filtered, sorted, paginated list with per-env summary, stale state, kill switch | `flag:read` |
| POST `/projects/:projectKey/flags` | create (initial configs: disabled, offVariation = second variation, fallthrough = first) | `flag:create` |
| GET `/projects/:projectKey/flags/:flagKey` | full detail incl. all env configs, active rollout, open change requests | `flag:read` |
| PATCH `/projects/:projectKey/flags/:flagKey` | metadata: name, description, tags, ownerId, lifecycle, add/rename variations | `flag:editMetadata` |
| POST `.../flags/:flagKey/archive`, POST `.../restore` | soft archive / restore | `flag:archive` / `flag:restore` |
| PATCH `.../flags/:flagKey/environments/:env` | direct config write `{ config, expectedVersion, reason, acknowledgeActiveRollout? }` (governance service); 409 `VERSION_CONFLICT` on mismatch; 409 `ROLLOUT_ACTIVE` unless acknowledged; 403 `CHANGE_REQUEST_REQUIRED` if protected | `flag:editConfig` |
| GET `.../flags/:flagKey/environments/:env/versions` | version history with diffs against the previous version, merged with kill-switch audit events | `flag:read` |
| GET `.../flags/:flagKey/environments/:env/compare?source=` | promotion diff | `flag:read` |
| POST `.../flags/:flagKey/environments/:env/promote { source, acknowledgeActiveRollout? }` | promotion (CR when target protected, otherwise direct); governance service | `changeRequest:create` / `flag:editConfig` |
| POST `.../flags/:flagKey/environments/:env/rollback { version, acknowledgeActiveRollout? }` | rollback (CR or direct); governance service | `changeRequest:create` / `flag:editConfig` |
| POST `.../flags/:flagKey/environments/:env/impact { proposedConfig }` | impact preview | `flag:read` |
| POST `.../flags/:flagKey/kill-switch { reason }`, DELETE `.../kill-switch` | activate / clear | `flag:killSwitch` |
| GET/POST `/projects/:projectKey/segments`, GET/PATCH/DELETE `.../segments/:segmentKey` | segment CRUD; DELETE returns 409 `SEGMENT_IN_USE` when referenced by any env config | `segment:read` / `segment:manage` |
| GET `/projects/:projectKey/change-requests?status=&flagKey=&mine=` | list | `changeRequest:read` |
| POST `/projects/:projectKey/change-requests` | create manual CR `{ flagKey, environment, title, description, proposedConfig }` | `changeRequest:create` |
| GET `/change-requests/:id` | detail with diff, reviews, comments, staleness | `changeRequest:read` |
| PATCH `/change-requests/:id` | edit title/description/proposedConfig (resets reviews) | `changeRequest:editOwn` |
| POST `/change-requests/:id/review { decision, comment }` | approve / reject | `changeRequest:review` |
| POST `/change-requests/:id/apply { acknowledgeActiveRollout? }`, `/rebase`, `/withdraw` | transitions; apply returns 409 `ROLLOUT_ACTIVE` unless acknowledged | per §5.3 |
| POST `/change-requests/:id/comments { body }` | comment | `changeRequest:comment` |
| GET `/projects/:projectKey/rollouts?status=` | list (calls `reconcileDue`) | `rollout:read` |
| POST `/projects/:projectKey/rollouts` | create plan `{ flagKey, environment, targetVariationId, baselineVariationId, bucketBy, steps }` | `rollout:manage` |
| GET `/rollouts/:id` | detail with timeline (calls `reconcileDue`) | `rollout:read` |
| POST `/rollouts/:id/pause`, `/resume`, `/abort` | transitions | `rollout:manage` |
| POST `/projects/:projectKey/evaluate` | playground evaluation | `playground:evaluate` |
| GET `/projects/:projectKey/audience?search=&limit=` | audience sample for the playground | `playground:evaluate` |
| GET `/projects/:projectKey/dashboard` | dashboard payload (§7.4) | `dashboard:read` |
| GET `/audit?projectKey=&entityType=&actorId=&before=&limit=` | activity feed (cursor by `at`) | `audit:read` |
| GET/POST `/projects/:projectKey/saved-views`, PATCH/DELETE `/saved-views/:id` | personal saved views | `savedView:manageOwn` |

Error codes (all non-500): `VALIDATION_ERROR` 400, `AUTH_REQUIRED`/`INVALID_TOKEN` 401, `PROFILE_REQUIRED` 401, `FORBIDDEN` 403, `CHANGE_REQUEST_REQUIRED` 403, `SELF_REVIEW_FORBIDDEN` 403, `NOT_FOUND` 404 (`FLAG_NOT_FOUND`, `PROJECT_NOT_FOUND`, …), `VERSION_CONFLICT` 409, `SEGMENT_IN_USE` 409, `ROLLOUT_ALREADY_ACTIVE` 409, `ROLLOUT_ACTIVE` 409, `DUPLICATE_KEY` 409, `INVALID_TRANSITION` 422, `INVALID_CONFIG` 422 (unknown variation/segment, weights ≠ 100000, rule count). `AUDIT_WRITE_FAILED` 500 is the one deliberate operational failure (§5.11).

Zod schemas live in controllers; services re-validate semantic rules (variation/segment references, weight sums, transitions).

## 7. Frontend

### 7.1 Router — `frontend/src/shared/router/`

`router.js` (≈80 lines): `navigate(path, { replace })`, `useRoute()` returning `{ path, params, query }`, pattern matching for `/projects/:projectKey/flags/:flagKey`, `popstate` handling, and `<Link>` that intercepts plain left-clicks. Vite's dev server serves the SPA fallback. Deep links and refresh work; the last visited project is remembered in `localStorage("rheostat-project")`.

Routes: `/` → redirect to `/projects/<last or first>/dashboard`; `/projects/:projectKey/{dashboard | flags | flags/:flagKey | segments | segments/:segmentKey | change-requests | change-requests/:id | rollouts | rollouts/:id | playground | audit | settings}`. Flag detail reads `?env=production&tab=targeting|history|rollouts`. Sign-in and profile selection are rendered by `App.jsx` state exactly as the reference (no URL).

### 7.2 Shell

Top bar: brand mark (a dial glyph + "Rheostat"), project switcher (`SelectMenu`), global flag search (jumps to flags list with `query`), theme toggle, profile menu (switch profile, sign out). Left rail: Dashboard, Flags, Segments, Change requests (pending-count badge), Rollouts (active-count badge), Playground, Audit, Settings. Rail collapses to icons under 960 px and becomes a drawer under 720 px; no horizontal overflow at 360 px.

### 7.3 Pages and components (feature folders)

- `features/auth` — `WorkspaceLogin.jsx`, `auth.api.js` (from reference, rebranded).
- `features/profiles` — `ProfilePicker.jsx` with role chips, `ProfileAvatar.jsx`, `profile.api.js`.
- `features/projects` — `ProjectSwitcher.jsx`, `ProjectSettings.jsx` (environments table: protection toggle, required approvals; people roles table for Admin), `project.api.js`.
- `features/flags` — `FlagsPage.jsx` (filters bar, saved-view chips, table with per-env state pills, stale/kill badges, sort), `FlagCreateDialog.jsx`, `FlagDetailPage.jsx` (header: name/key/type/tags/owner/lifecycle, kill-switch banner and button, archive), `EnvironmentTabs.jsx`, `TargetingEditor.jsx` (enabled toggle, off variation, rule list with `RuleEditor.jsx`/`ClauseEditor.jsx`, fallthrough with `ServeEditor.jsx` and weight sliders, "Preview impact" panel, Save / Propose change), `ImpactPreview.jsx`, `VersionHistory.jsx` (timeline with `DiffView`, rollback action), `EnvironmentCompare.jsx` (promotion), `VariationsEditor.jsx`, `flag.api.js`.
- `features/segments` — `SegmentsPage.jsx`, `SegmentEditor.jsx`, `segment.api.js`.
- `features/change-requests` — `ChangeRequestsPage.jsx` (tabs: needs my review / mine / all), `ChangeRequestDetailPage.jsx` (diff, impact, reviews, apply/rebase/withdraw, comment thread), `ChangeRequestComposer.jsx` (title/description when proposing), `change-request.api.js`.
- `features/rollouts` — `RolloutsPage.jsx`, `RolloutDetailPage.jsx` (step timeline SVG, pause/resume/abort, held/stalled notices), `RolloutPlanner.jsx` (target/baseline/bucketBy, step builder with presets 5/25/50/100), `rollout.api.js`.
- `features/playground` — `PlaygroundPage.jsx` (environment, context editor with attribute rows, "load audience member", results table with reason explanations), `evaluation.api.js`.
- `features/dashboard` — `DashboardPage.jsx` with `StatTile`, `ActivityChart.jsx` (SVG stacked bars, 14 days, simulated vs playground), `DistributionBars.jsx`, lists for active rollouts, pending approvals, recent production changes, ready-to-remove, overdue, kill switches; `dashboard.api.js`.
- `features/audit` — `AuditPage.jsx` (filters, cursor "load more"), `audit.api.js`.
- `features/saved-views` — `SavedViewMenu.jsx`, `saved-view.api.js`.
- `shared/` — `api/client.js` (reference client, `rheostat-*` storage keys), `router/`, `components/` (`Modal`, `ConfirmationDialog`, `SelectMenu`, `MaterialIcon` with the additional glyphs we need, `Toast`, `EmptyState`, `Skeleton`, `DiffView`, `StatusPill`, `Tabs`, `Badge`, `Tooltip`), `utils/` (`date.js`, `theme.js`, `identity.js`, `permissions.js` for `can(permissions, action)`), `styles.css` (reference tokens preserved; new component classes appended).

### 7.4 Dashboard payload

`{ flagCounts: { total, active, archived, temporary, readyToRemove, overdue, killSwitched }, activeRollouts: [{ id, flagKey, environment, status, currentPercent, nextStep }], pendingChangeRequests: { needsMyReview: n, mine: n, items: [...] }, recentProductionChanges: [FlagVersion + actor + flagKey] (10), staleFlags: [{ flagKey, readyToRemove, overdue, removeBy, lastEffectiveChangeAt }], killSwitches: [...], evaluations: { days: [{ date, playground, simulated }] (14), byFlag: [{ flagKey, total, variations: [{ variationId, name, count }] }] (top 8) } }`.

### 7.5 State handling (every page)

Loading skeletons; empty states with a primary action; inline validation messages under fields (mirroring backend `details`); disabled controls with a tooltip naming the missing permission or the protected-environment rule; success toasts; error banners with Retry; a "This flag changed since you opened it" conflict state that offers Reload; confirmation dialogs for destructive or high-impact actions (archive, delete segment, kill switch, abort rollout, apply to production). Theme (dark default, light) persists in `localStorage("rheostat-theme")`.

## 8. Seed data (`backend/src/scripts/seed.js`)

Deterministic and relative to today (`DEMO_TODAY` override supported as in the reference). Clears every collection, syncs indexes, then inserts:

- 5 people + 5 accounts (§3.3), all accounts allowed all profiles.
- 2 projects × 3 environments (production protected, 1 approval).
- 8 segments (`beta-testers`, `enterprise-plans`, `eu-users`, `ios-latest`, `internal-staff`, `high-value`, `android-beta`, `new-signups`) across both projects.
- 16 flags covering every state: off everywhere; rules only; mid-rollout in production; fully rolled out and untouched 20 days (ready to remove); temporary with `removeBy` in the past (overdue); kill-switched; archived; multivariate string (`checkout-layout`: control/compact/express); number (`search-page-size`); json (`pricing-banner`); permanent operational flags.
- ~40 `FlagVersion`s with realistic reasons and mixed sources.
- 6 change requests: pending manual, approved awaiting apply, conflicted, applied promotion, rejected, withdrawn — with reviews and comment threads.
- 3 rollout plans: running (a step applied yesterday, next step tomorrow), paused, completed.
- 1000 audience members (500 per project) from a seeded PRNG (mulberry32) with realistic names, countries, plans, platforms, versions, signup dates.
- ~2500 `EvaluationLog`s over the last 14 days, `source: simulated`, distributed by the flags' actual configurations (generated by running the evaluator over audience members so distributions are truthful).
- ~80 audit entries consistent with the versions, change requests, and rollouts above.
- 2 saved views for Diego and 1 for Marcus.

The seed prints collection counts and the demo credentials, as the reference does. The README documents the same counts as the baseline.

## 9. Runtime, repository, and documentation

- Root `package.json`: name `rheostat`, workspaces `frontend`/`backend`, scripts `prestart`, `start`, `dev:frontend`, `dev:backend`, `seed`, `test` (`bun test` — Bun discovers `*.test.js` recursively from the root, so one command runs the backend domain tests and the frontend router tests; `cd backend && bun test` runs only the backend set), devDependency `concurrently` pinned as reference.
- `backend/package.json` and `frontend/package.json`: exactly the reference dependencies at exactly the reference pinned versions. The contract permits "at least as recent" (REQUIREMENTS.md, INSTRUCTIONS.md §4), but an upgrade buys nothing and creates validator risk, so a version bump happens only for a concrete, documented reason (a bug we hit or a published advisory) recorded in the README. No additions, replacements, or convenience upgrades. `bun.lock` is regenerated by `bun install` because workspace names change (lockfile normalization, allowed by the validator). `backend` adds `"test": "bun test"`.
- `setup.sh`, `hackerrank.yml` (same commands, same `readonly_paths`, `default_open_files` → `backend/src/app.js`, `frontend/src/App.jsx`), `.vscode/launch.json` ("Debug Rheostat Application"), `.prettierrc`, `.prettierignore`, `.editorconfig`, `.gitignore` copied from the reference.
- `.gitattributes`: reference entries plus `GUIDELINES.md export-ignore` and `skills/ export-ignore` — exactly what GUIDELINES §3.6 names. `docs/` (this spec, the plan, and review history) stays in the archive deliberately: REQUIREMENTS.md scores "feature selection, architectural decisions… must reflect clear human judgment", and these documents are that evidence.
- `.env.example` files: backend `PORT=8000`, `NODE_ENV=development`, `MONGODB_URI=mongodb://localhost:27017/rheostat_db`, `JWT_SECRET=rheostat-secret-jwt-key-2026`, `JWT_EXPIRES_IN=24h`; frontend `VITE_API_URL=/api/v1`.
- JWT issuer `rheostat-api`, audience `rheostat-app`.
- `backend/public/` favicon and index; `frontend/public/favicon.svg`; brand mark drawn in CSS/SVG (no external media).
- Root `README.md` covers the eight required areas: product identity, technology stack, annotated project structure, prerequisites, MongoDB behavior (connection, seed, reset on start, baseline counts), run instructions, command reference (including `bun test`), seeded access (credentials, profile roles, what each role can do).
- `transcripts/` receives the AGENTS.md log at submission; `skills/validate` stays in the repo and out of the archive.

## 10. Testing strategy

`bun test` (built into Bun, no dependency) over colocated `*.test.js` files in `backend/src/**` and `frontend/src/shared/router/`. The acceptance criterion is qualitative, not a count: **every business rule stated in §5 has at least one test that would fail if the rule were removed, and every state transition and every concurrency/recovery branch has its own case.**

- `evaluator.test.js`: precedence order, every operator incl. negate and missing attributes, segment include/exclude/rules, bucketing determinism and approximate distribution over 10 000 keys, weight boundaries, multivariate splits, and a **rule whose serve is a rollout** (rule precedence plus bucketing in one path).
- `config-diff.test.js`: equivalence, added/removed/changed rules, clause-level changes, deterministic ordering.
- `transitions.test.js`: every row of the state table, self-review rejection, approval threshold from the policy snapshot, edit resets reviews, conflict detection, terminal states.
- `plan.test.js`: validation (including the baseline-equals-current-fallthrough precondition), weights derivation, due-step selection, resume shifting, abort marking remaining steps skipped, completion regardless of final percent.
- `reconcile.test.js`: the reconcile decision table with an in-memory fake of the guarded updates — claim contention, version mismatch → stalled, same-version race → retry, kill-switch hold, `expectedVersion` advancing after success, and all four **stale-claim recovery** cases of §5.5 (version exists → finalize; nothing written → release; flag written but snapshot missing → insert and finalize; ambiguous → stalled).
- `governance.test.js`: active-rollout guard (409 without acknowledgement, proceeds with it, exemptions for kill switch/metadata/CR creation), protection routing to change requests, promotion normalization.
- `lifecycle.test.js`: ready-to-remove and overdue definitions, metadata edits not resetting staleness.
- `permissions.test.js`: matrix spot checks and environment-aware rules.
- `frontend/src/shared/router/match.test.js`: pattern matching, query parsing, path building.

Services depend on repositories through module imports as in the reference; the pure modules above hold all decision logic so the tests need neither HTTP nor MongoDB. Runtime behavior is verified with the validate skill's R01–R12 checks.

## 11. Out of scope

Experimentation statistics, client SDKs, webhooks/integrations, JSON import/export, nested segments, multiple organizations or per-project membership, scheduled *changes* other than rollouts, per-environment kill switches, regex targeting, and real-time updates.
