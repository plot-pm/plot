## Implementation brief — one-release-job-per-plan (wave: Release jobs)

- **Plan (canonical):** docs/plans/2026-10-28-parallel-release-calls-exhaust-their-push.md on main
- **Approved:** 2026-10-28, Jan Wloka, plan-PR #2816 merged
- **Branch:** `bug/one-release-job-per-plan` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review app required on main)

This is slice 3 of 5. Waves 1 (`bug/booking-branches-carry-no-upstream`, #2838) and 2 (`bug/the-push-lock-spans-the-booking`, #2860) are both **merged**, so `--no-track` booking and the lock-spans-the-booking fix are already on `main` — nothing here depends on an unmerged sibling. Wave 4 (`bug/shared-issue-reads-the-post-push-tree`) and wave 5 (`docs/release-step-5b-reads-each-outcome`) have not started; the plan's Notes say slices 1, 3 and 4 touch separate files and can merge in any order, so this branch is not blocked on either.

### What to build

`handleRelease` in `packages/board/src/server/release.ts` (around line 150 on current main) unconditionally does `fs.rmSync(statePath, { force: true })` then `fs.openSync(log, 'w')` on every `POST /api/release` call for a slug — even when a job for that same slug is already running. A second call truncates the first job's still-open log file descriptor's target and overwrites its state, so `releaseStatus` can report the wrong job's outcome. This is the exact mechanism behind the 2026-10-28 incident in the plan's Motivation: three surviving logs held NUL bytes where a second call truncated the log under a first, and one plan-state write happened twice.

Add a refusal: `POST /api/release` must check whether a job for this slug is already `running` (via the existing `releaseStatus`) and refuse with 409 rather than opening a second log over the first.

### Settled decisions — do not re-derive them

**The precedent is `interrogate.ts`'s already-running guard, not `dispatch.ts`'s.** `handleInterrogate` (`packages/board/src/server/interrogate.ts`, search `already-running`) already does exactly this shape for panels: it calls `interrogateStatus(opts, slug).state === 'running'` before doing anything else, and refuses 409 with `{ ok: false, slug, reason: 'already-running', detail }` naming the log path to watch. `dispatch.ts`'s "second POST refused" guard is a different shape — it guards the `/plot-implement` pre-step via `startDispatch`'s own job tracking, not a slug-keyed status file — so model the release guard on `interrogate.ts`, which already reads status from the same kind of state/log file pair `release.ts` uses.

**"Status is kept per job, so a log is never truncated by a second call" (plan, Slice 3) means: the refusal must happen BEFORE `fs.rmSync`/`fs.openSync` run, not after.** The current code opens and truncates unconditionally; moving the `releaseStatus` check to the top of `handleRelease`, ahead of the truncation, is the whole fix. No new state format, no job-ID field, no queue — `releaseStatus`'s existing `running`/`done`/`failed`/`unknown` states are kept as-is per the plan's Decisions list ("no `queued` state"). "Per job" here means *the existing job already running for this slug keeps its own log*, achieved by refusing the second job outright — not a new per-job identity scheme.

**A refused call answers synchronously and spawns nothing.** Mirror `interrogate.ts`'s pattern: the `already-running` check runs before `readJsonBody`'s cross-origin/body work is wasted on a call that's going to be refused anyway — check `interrogate.ts`'s actual ordering (origin check, then body parse, then slug validation, then the running check) and follow the same order in `release.ts`, rather than inventing a different check order for no reason.

**Do not add a `queued` status.** The plan's Decisions list is explicit: "A waiting job keeps the existing `releaseStatus` states (`unknown`, `running`, `done`, `failed`); no `queued` state." A second call for a running slug is refused outright (the caller retries later, same as a panel's `already-running`), not queued for later execution. This is a smaller, simpler fix than it might look — resist the urge to build a job queue.

### Done when

The plan's Slice 3 test (under `### Tests`) is the spec:

> a board unit test on the release route: a second POST for a running slug is refused and leaves the first log untouched; status for one job never reports another job's exit code.

Concretely:
- A test (likely in `packages/board/test/release.test.mjs`, alongside the existing route contract tests) that starts a release for slug A, then — while it is still `running` — POSTs a second release for the same slug A, and asserts: the second call gets 409 (not 202), the first call's log file is byte-for-byte unchanged by the second call, and a later `GET /api/release/A` reports the first job's outcome, not an error or an overwritten state.
- A second POST for a *different* slug B, while slug A is still running, must still succeed with 202 — the refusal is per-slug, not a global lock on the release route.

Each of these exists because a naive fix that just adds the check but reads `releaseStatus` after the `fs.rmSync`/`fs.openSync` truncation would still pass a test that doesn't start two overlapping calls against the same slug — the test must actually overlap them (hold the first job open, e.g. via a slow stub script or by checking status mid-flight) to catch the truncation-order bug this slice exists to fix.

Plus: this repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — the related/changed-file tests and typecheck for `packages/board/**`, plus the gate tests and `scripts/check-*.sh` scripts. The suites in the `CI suites` config key run in CI on every PR — do not run them locally as a matter of course; a failure there comes back as a correction.

`scripts/check-shell-lines.sh` is not expected to matter here — this slice is TypeScript only (`release.ts` plus its test), no `.sh` file under `skills/` grows.

### Bookkeeping

Open the PR through the controller once there's a first real commit:

```bash
../plot/scripts/plot-open-pr.sh          # current branch
../plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

It reads which plan names this branch and titles the PR from the plan's wave heading ("Release jobs"). Do not run `gh pr create` directly. Push the first real commit as soon as it exists.

When the PR is created, append `→ #<number>` to this branch's line under the `### Release jobs` heading in the plan's `## Slices` section.

### Scope guard

This branch owns:
- `packages/board/src/server/release.ts` — `handleRelease`'s refusal ordering (add the `releaseStatus`-before-truncation check); `releaseStatus` itself likely needs no change since its states already cover what's needed
- its test file, `packages/board/test/release.test.mjs` (or a new focused test file if that one doesn't fit the overlapping-call shape)

Other branches in flight on this plan, verified at dispatch time rather than guessed:
- `bug/booking-branches-carry-no-upstream` (wave 1, #2838) — **merged**, touches `packages/domain/src/adapters/trees/trees-git.ts` only, no overlap.
- `bug/the-push-lock-spans-the-booking` (wave 2, #2860) — **merged**, touches `packages/board/src/server/entry/ladder.ts`, `plot-push-main.sh`, `plot-push-lock.mjs`; no overlap with `release.ts`'s route-level refusal (it changes what happens inside `commitAndPush`, called deep inside the script this route spawns, not the route itself).
- `bug/shared-issue-reads-the-post-push-tree` (wave 4, not started) — touches `packages/board/src/server/entry/deliver.ts` (`siblingLinesOf`), not `release.ts`. No file overlap, but logically adjacent: it also concerns the release arm's behaviour on the same code path this route spawns (`plot-deliver.sh --release`).
- `docs/release-step-5b-reads-each-outcome` (wave 5, not started) — skill text only (`skills/plot-release/SKILL.md`), reads `GET /api/release/<slug>` which this slice does not change the shape of (still `unknown`/`running`/`done`/`failed`).

If you find something the plan did not anticipate, report it rather than improvising outside scope.
