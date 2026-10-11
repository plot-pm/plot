## Implementation brief — the-fleet-closes-its-review-findings (wave: The board writes no index)

- **Plan (canonical):** [docs/plans/2026-10-10-the-fleet-closes-its-review-findings.md](../../docs/plans/2026-10-10-the-fleet-closes-its-review-findings.md) on `main`
- **Approved:** 2026-10-10, Jan Wloka, plan-PR #1499 merged
- **Branch:** `bug/the-board-writes-no-index` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR (per `## Plot Config` — `Review: pr`)

This slice touches `packages/board/src/server/fleet.ts`, `packages/domain/src/ports/fleet-state.ts` (and its adapter), and the PR-index tests that move to `packages/fleet` — checked 2026-10-11, no local or remote ref for `bug/the-board-writes-no-index` yet. This brief and its `Started:` record claim no branch, per `--brief-only`.

### What to build

Five findings (#1445 M2, M3, L4, L6-blank-lines) share one root cause: `fleet.ts` still has a path that writes the real PR-index store, and the board's owned-mode read path repeats work and hides failure. Fix each at its own site.

**M2 — `refreshPrs` can write the real store.** `refreshPrs` (`fleet.ts:1655-1659`) takes `store: PrIndexStore = prStoreFor(opts.repoRoot)` as a default parameter. Every caller the board itself takes today happens to pass `overlayFor(opts, entry)` (the in-memory overlay, `fleet.ts:1692`) — but the default is live, reachable by any future or test caller that omits the third argument, and `one-pr-index-writer.test.ts` only greps for `foldPrIndex` imports, which `fleet.ts` never names directly even though it can still reach the real file through this default. Make `store` a required parameter. Every current board call site already supplies `overlayFor(...)`, so this is a signature change with no behavior change at the only real caller — the risk it closes is a caller that doesn't exist yet.

**M3 — a failing PR reader is invisible while a fleet runs.** `readPrsFromStore` (`fleet.ts:1634-1647`, the owned-mode path `maybeRefreshPrs` takes when `fleetOwnsPrs` is true) only updates `entry.prError` on the success branch (`held.ok && held.value !== null` → `entry.prError = null`, `:1643`). A store read that fails (`held.ok` false) or returns null falls through having touched neither `entry.prError` nor anything else — the board keeps showing whatever `prError` held from the last standalone (fleet-less) run, typically `null`, so a fleet whose PR reader is actually failing renders as healthy.

**L4 — owned-mode refresh repeats display reads regardless of change.** `refresh` (`fleet.ts:1918` `entry.versions = await releaseVersions(opts)`, `:1926` `entry.unmerged = await unmergedBranches(...)`, `:1932` `entry.questions = await workerQuestions(parsed)`, and `:1770` `entry.supervisor = await readSupervisor(opts)`) runs these on every tick whether or not the bridge's `at` timestamp moved. In owned mode the fleet is the thing producing new state; a tick where `bridged.at` is unchanged from the previous read is a tick where none of these four answers can have changed either, and recomputing them anyway is the cost L4 names.

**L6 (blank lines) — twelve blank lines before `fleet.ts:1609`.** Literal dead whitespace ahead of the `overlays` WeakMap declaration (count confirmed 2026-10-10 in the plan's review table; verify the exact run still holds before deleting, since the file moves between findings).

### The decisions the plan settles — do not re-derive them

- **The fix for M2 is a signature change, not a new guard.** Do not add a runtime check ("refuse if store is the real one") — that is a rule a test can't fully trust. Removing the default forces every call site to state its store explicitly, which is the gate: a future caller that means to write the real file now has to say so, and a caller that doesn't is a type error, not a silent footgun.
- **M3's fix adds an error path to `readPrsFromStore`, it does not change what `readPrsFromStore` is for.** This function still "serves the maps the fleet's last fold left in the store, and asks the host nothing" (its own TSDoc, unchanged). The fix sets `entry.prError` to a readable message when `held.ok` is false or `held.value` is null and no prior successful read exists for this entry — it must not make `readPrsFromStore` fall back to asking the host; that fallback is `refreshPrs`'s job in the un-owned branch, and blurring the two reintroduces the thing M2 just closed off.
- **"The fleet's last PR error" is new state, not a repurposing of `entry.prError`.** The plan's slice line says *"the board shows the fleet's last PR error"* — the fleet (not the board) is what actually calls the host and can fail; today's `BridgedPulse` (`packages/domain/src/ports/fleet-state.ts:69-80`) carries six fields (`at`, `pulse`, `ages`, `branchUrlBase`, `approvedAt`, `ideaPlans`) and none of them is an error. Add a seventh field to `BridgedPulse` — confirmed empty today; this is new territory, not a rename. `FleetState`'s own doc says all six fields "written together on every success so a thin or partial write can never become the bridge's final content" — the new field joins that same all-or-nothing write, and `readPrsFromStore` reads it onto `entry.prError` in owned mode instead of (or alongside) its own local success/failure logic. Whichever process actually calls the PR host in owned mode (the fleet, via `pr-refresh.ts`) is what sets this field; the board only relays it.
- **L4's fix is gated on `bridged.at`, the same timestamp `entry.at` already derives from (`fleet.ts:1943`).** Do not invent a second staleness signal. The pattern already exists for `ages`/`tipAt`/`branchUrlBase`/`approvedAt`/`ideaPlans` at `fleet.ts:1916-1921` (the `else if (bridged !== null)` branch) — `entry.versions`, `entry.unmerged`, `entry.questions`, and `entry.supervisor` need the equivalent "skip if `bridged.at` matches what was last applied" guard. Track the applied `at` per entry (a new field on `CacheEntry`, or reuse `entry.prAt`/`entry.at` if one already serves — check before adding a third). The un-owned (fleet-less) path must not gain this skip: there `bridged` may be stale or absent and the board is the only thing computing these values at all.
- **`--log-pulse` is out of scope here, same as the sibling slice "The scan writes once" already established.** The plan's heading cites #1445 L6 under *this* slice's answer list, but only for the blank-lines text defect — the `--log-pulse` thin-write finding is `bug/the-scan-writes-once`'s to answer (its own brief at `.plot/briefs/the-scan-writes-once.md` covers it). Do not touch `plot-fleet-scan.sh` from this branch.
- **The store-writing tests move to `packages/fleet`, per the plan's own slice line.** Any test currently under `packages/board` that exercises `prStoreFor`, `prIndexFile`, or a real (non-overlay) `PrIndexStore` write belongs beside the fleet code that is now the only legitimate writer — grep `packages/board/test` for `prStoreFor` and `prIndexFile` before assuming none exist.
- **`one-pr-index-writer.test.ts` (`packages/fleet/test/unit/`) currently only asserts `foldPrIndex` importers are `{domain, fleet}`.** That assertion already passes today and will keep passing after M2's fix (the fix is a signature default, and `fleet.ts` never imported `foldPrIndex` in the first place — it reached the real store a different way, through the default parameter). Decide whether this test needs a second assertion that also rules out the default-parameter path, or whether the M2 fix alone (making the parameter required) is sufficient because TypeScript itself now refuses an omitted argument. Favor the type-level fix — it is a compile error, which is stronger than a grep.

### Done when

The plan's `## Done when` list does not name this slice's tests directly (covered implicitly by "each test below fails on `origin/main` … today" plus the local-checks line). The specification for this slice:

- `refreshPrs` has no default for its `store` parameter — a call site that omits it is a compile error, verified by `pnpm --filter @plot-pm/board exec tsc --noEmit -p .` failing on an intentionally-reverted third argument, then passing once it's required.
- A new test (co-located with `readPrsFromStore`'s existing coverage) proves: a store read that fails, or returns `null`, sets `entry.prError` to a non-null message rather than leaving the previous value untouched.
- `BridgedPulse` carries the fleet's last PR error as a new, documented field, written on every bridge write alongside the existing six — a test proves a bridge round-trip (write then read) preserves it, including the case where the error is `null` (no failure to report).
- A test proves owned-mode `refresh` does NOT recompute `entry.versions`, `entry.unmerged`, `entry.questions`, or `entry.supervisor` on a tick where `bridged.at` is unchanged from the previously-applied value, and DOES recompute them when `bridged.at` advances.
- The twelve blank lines ahead of `fleet.ts:1609` are gone (re-count first; the file has moved since the finding was written).
- `one-pr-index-writer.test.ts` passes, and its assertion is strengthened or confirmed sufficient per the decision above — document which, in the PR body.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. This slice touches `packages/board/src/**` and `packages/domain/src/**` (the port) and likely `packages/fleet/src/**` (the adapter write side and the moved tests), so expect `pnpm --filter @plot-pm/board exec vitest related --run {changed}`, `pnpm run typecheck`, `pnpm --filter @plot-pm/domain exec vitest related --run {changed}`, `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .`, and `pnpm --filter @plot-pm/fleet exec vitest related --run {changed}` in its output, plus the repo-wide `check-*.sh` gates. The suites in the `CI suites` config key run in CI on every pull request; a failure there comes back as a correction. Do not run `test:e2e` locally — it dispatches real workers into sandbox repos and is CI's gate, not a local one.

**This slice is expected to touch no `.sh` file.** If investigation turns up a reason a shell script needs a change, `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` grows past its merge base — pay for growth by removing shell elsewhere in the same change.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line under `## Slices` in the plan.

### Scope guard

This branch owns:

- `packages/board/src/server/fleet.ts` — `refreshPrs`'s required `store` parameter, `readPrsFromStore`'s error path, the owned-mode `refresh` skip-when-unchanged guard, and the blank-line cleanup near `:1609`
- `packages/domain/src/ports/fleet-state.ts` — the new last-PR-error field on `BridgedPulse`, documented
- the `fleet-state-file.ts` adapter (or equivalent) that implements the port's read/write of that field
- `packages/fleet/src/shared/pr-refresh.ts` (or wherever owned-mode PR fetching lives) — setting the new error field when the host ask fails
- `packages/fleet/test/unit/one-pr-index-writer.test.ts` and any PR-index store-writing test moved from `packages/board/test` into `packages/fleet/test`

It does not touch `skills/plot/scripts/plot-fleet-scan.sh` or `packages/fleet/src/shared/fleet-clock.ts` (slice "The scan writes once" owns the `--log-pulse`/`record` findings — #1445 M1 and the `--log-pulse` half of L6), `packages/fleet/src/shared/auto-deliver.ts` (slice "A failed delivery retries" owns #1453), or anything in the other ten slices' scope. Per the plan's ordering note (`## Design` → "One branch per heading"), slices 6, 7 and 8 — "The scan writes once," this slice, and "A failed delivery retries" — all touch the fleet's PR and scan code and are meant to run one after another rather than in parallel; re-check `git log --oneline -- packages/board/src/server/fleet.ts packages/domain/src/ports/fleet-state.ts` for sibling activity before starting, in case time has passed since this brief was written.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
