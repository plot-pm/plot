## Implementation brief — open-plot-review-findings-from-the (slice: Idle slice)

- **Plan (canonical):** `docs/plans/2026-11-03-open-plot-review-findings-from-the.md` on main
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3075 merged
- **Branch:** `bug/an-idle-episode-survives-a-restart` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** the review gate (`plot/review`), as for every slice of this plan

The slice has no `waits:` marker. The plan's *Ordering* names one textual conflict: `registryd-main.ts` is also edited by #3067's `feature/fleetd-starts-the-unblocker`, which exports the tick options builder. Rebase on whichever lands first.

### What to build

Fix #2933. Each fleetd restart notifies every idle slice again. `clockStartMs` in `packages/domain/src/rules/slice-idle.ts` takes `max(fleetdStartedAt, last moved line, createdAt)`, `sliceIdle` writes that value into the verdict's `clockStart`, and `idleEpisodeKey(branch, clockStart)` makes it half of the episode key. A restart moves `fleetdStartedAt`, so the key changes, `recordedEpisodes` no longer holds it, and the slice notifies again once `Slice idle after` (2 h) has passed. `createdAt` is always `''` (`idleWorldForRepo`, `registryd-main.ts` near line 1185), so a slice with no `moved` line has the restart time as its only clock and repeats after every restart.

The fix: the episode key drops fleetd's start. The idle clock keeps it, so fleetd's start still only delays the first notification. A slice with no `moved` line keeps one key for its whole life. That is the intended answer, not a gap.

The plan is canonical; this brief is orientation.

### Settled decisions — do not re-derive them

**Two clocks, not one.** The idle clock (`now - start > boundMs`) keeps `max(fleetdStartedAt, moved, createdAt)`. Dropping fleetd's start from it would declare every slice idle one tick after a restart, and the existing test `is not idle just after fleetd starts` (`slice-idle.test.ts:54`) stays unchanged on purpose. Only the key loses the term. The verdict therefore needs a second field for the key's clock; `clockStart` alone cannot serve both.

**The key must still change on a new `moved` line.** The docstring of `idleEpisodeKey` says a new moving line starts a fresh episode with no second ledger. The key clock is `max(moved lines, createdAt)`, and the existing test at `slice-idle.test.ts:112-122` (a second episode after a later moved line) must still pass.

**A run-log line with an empty `at` is dropped by the decoder.** `decodeRunLogLine` (`packages/domain/src/adapters/run-log/run-log-file.ts:81`) returns `null` when `plan === '' || at === ''`. The `notified` line's `at` IS the key's clock (`notifyIdleSlices`, `registryd-main.ts`, `at: item.clockStart`). A slice with no `moved` line and no `createdAt` has no timestamp for its key, and an empty string there would write a line that never reads back, so the slice would notify every tick. This is the failure a naive fix hits. Give such a slice a fixed non-empty sentinel as its key clock, and prove it with a test that round-trips the line through `decodeRunLogLine`.

**Existing `notified` lines carry the old key (a fleetd-start clock).** They never match a new key, so each slice notifies once more after this ships. That is a one-time cost, not a defect. Do not add a migration or a second ledger for it. Say it in the changeset.

**No `createdAt` work.** The `Host` port does not read a PR's creation time, and adding it touches the port, the shell adapter and `plot-host.sh`. The `idleWorldForRepo` docstring names this gap. This slice leaves it; only the comment's account of the clock changes.

Carried-over rules: absent is not false (an unparseable `createdAt` is absent from the `max`, not zero); read the run log's decoded value, never its raw text; delivery stays at-least-once (a crash between send and append repeats the message, and the plan accepts that).

### Done when

The plan's `## Tests` section, *Idle slice tests*, is the specification:

- `packages/domain/test/slice-idle.test.ts`, new: `an unmoved slice keeps one episode key across two fleetd starts`. Two `sliceIdle` calls with different `fleetdStartedAt`; today the second answers `isNew: true`. It must fail on `main` before the fix.
- `slice-idle.test.ts:54` (`is not idle just after fleetd starts`) is unchanged.
- The existing second-episode test (`:112-122`) still passes: a later `moved` line gives a new key.

Add these, because a naive fix passes without them:

- A round trip: the key clock a no-`moved` slice writes into the `notified` line's `at` decodes through `decodeRunLogLine` and `recordedEpisodes()` returns the key. In `packages/fleet/test/unit/registryd-idle.test.ts`, next to the existing recorded-episode tests (`:112`, `:197`). It catches the empty-`at` drop above.
- A restart in the fleet test: `idleWorldForRepo` with two different `fleetdStartedAt` values and the same run log answers no new episode the second time.

Plus: the `createdAt` comment at `registryd-main.ts` (near line 1128-1160) and the `idleEpisodeKey`, `clockStartMs` and `notifyIdleSlices` docstrings now describe two clocks. A changeset (`plot` package, patch; description first, `bumps:` block last, one plain sentence with the number: *"an unmoved slice notifies once, not once per fleetd restart"*). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.

This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count. New functions are arrows.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while work moves). Never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/slice-idle.ts`, `packages/domain/test/slice-idle.test.ts`, the idle parts of `packages/fleet/src/server/entry/registryd-main.ts` (`idleWorldForRepo`, `notifyIdleSlices`), `registryd.ts` (`idleNotifyWrites`), `IdleNotifyWrite` in `packages/domain/src/workflows/decision.ts`, `packages/fleet/test/unit/registryd-idle.test.ts` and `registryd-tick.test.ts` (idle cases only), and one changeset.

In flight on the same plan: `bug/holding-work-reads-unpushed-commits` (#3182, `ending-action.ts` and `registryd.ts:1259`) and `bug/a-red-main-stays-acted-on` (#3177, repair rules). The first also touches `registryd.ts`, in the ending-action call, not in `idleNotifyWrites`. Elsewhere, #3067 edits `registryd-main.ts` (the tick options builder). Keep to the idle functions to keep these conflicts textual.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
