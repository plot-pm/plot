## Implementation brief — manifest-retry-and-race-findings (wave 2: Start and stop)

- **Plan (canonical):** [docs/plans/2026-10-17-manifest-retry-and-race-findings.md](../../docs/plans/2026-10-17-manifest-retry-and-race-findings.md) on `main`
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1968 merged
- **Branch:** `bug/a-continue-starts-one-loop` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

`bug/the-implement-lock-covers-its-start` led this plan and merged as PR #1999 (`8c27ab11a`). This branch reuses the lock shape it settled rather than inventing a second one. `bug/a-failed-continue-leaves-its-desk-whole` waits on this branch — both touch `continue.ts` and `continue-route.test.ts` — so land this one first and keep the manifest-ordering fix out of scope here.

### What to build

Issue #1841 names #1357 and #1377 as this slice's findings, both in `continueOnDesk` (`packages/fleet/src/shared/continuation.ts`). Re-check each against main first; the line numbers below are current as of `918fa3c73`.

1. **No lock between the live-loop check and the pid-file write (#1357).** `continueOnDesk` reads `continueTarget` (line 608) — which asks `readDeskLoop`/`deskWaitsFree` for a live loop — and does not take any lock before it writes the manifest, spawns (line 802), and writes `.plot-worker.pid` (line 842). Two callers racing `POST /api/continue` for the same worktree — a double-click, or a click racing a supervisor tick — can both pass the `loop-alive` check before either has spawned, and both start a worker in one worktree. Take a per-desk lock around this whole sequence: the `continueTarget` read, the stop (if any), the spawn, and the pid-file write. Build it in the same shape #1528/#1999 settled for the implement lock — `publishLock`/`takeGuard`/a `*Held` predicate reading pid + start time, keyed this time by worktree rather than by slug — not a `Set` and not a new kind of lock manager.
2. **The spawn has no `'error'` path that releases the lock.** `continueOnDesk`'s `child.on('error', ...)` (line 828) only logs; it does not reject or return a `failed` result, so a spawn that never fires `'exit'` (e.g. the `sh` binary is missing) leaves the function hanging and, after this slice's lock exists, leaves the lock held forever. Give the `'error'` handler a path that settles the awaited promise with a `failed` result and releases the new lock before returning.
3. **A stale pid file reads as the previous, dead loop (#1357, second half).** `readDeskPid` (`packages/fleet/src/shared/registry.ts:178`) reads `.plot-worker.pid` with no time bound — it is the same reader `deskPidAlive` complements, and neither checks the file's age against a spawn's start time. After this slice's lock, the stale-read risk narrows to the lock's own bound, but `readDeskPid`'s unconditional read is still the fact #1357 names: a caller cannot currently tell "this pid is fresh" from "this pid is whatever the last loop left." Decide in the PR whether the lock closing the race window is sufficient, or whether `readDeskPid` itself needs a freshness check, and say which with the measurement that decided it.
4. **The wrapper can write `.plot-worker.exit` after the route removed it (#1377, first half).** `continueOnDesk` removes `.plot-worker.exit` (line 753) before spawning a direct child — it starts no wrapper. But `plot-dispatch.sh`'s wrapper, from an EARLIER dispatch on the same worktree, can still be mid-flight if the desk's previous loop was only an agent process racing a dispatch wrapper's exit write. Re-check against main whether this is live: `plot-worker-loop.sh`'s own exit-write ordering relative to `continueOnDesk`'s removal, and whether the per-desk lock from item 1 already closes this because a continuation cannot start while a dispatch holds the desk.
5. **The freewait file leaks, and its name is defined twice (#1377, second half).** `.plot-worker.freewait` is independently defined as `FREE_WAIT_FILE` in `packages/domain/src/adapters/desk/desk-fs.ts:41` and `FREE_WAIT_FILENAME` in `packages/domain/src/rules/desk-loop-alive.ts:92` — two string literals that happen to agree today and have no test holding them together. `continueOnDesk`'s stop path (lines 657-668) reads the freewait record via `deskFreeWait`/`deskWaitsFree` but never removes the file after a successful stop, so a desk that was waiting free before the stop can still read `waitsFree` for the old pid after a new loop has started. Collapse the two definitions to one export both modules import, and remove the freewait file as part of the stop sequence (after `stopAndAwaitExit` succeeds, before the manifest restore).

### The decisions the plan settles — do not re-derive them

**The lock shape is not open for redesign here.** The plan's Design says the start lock goes in "the same shape #1528 settles for the implement lock, so the two do not diverge," and #1999 already landed the main-checkout resolution as its own export, `mainCheckout` in `packages/fleet/src/shared/main-checkout.ts` — a continue lock keyed on a desk worktree needs no main-checkout resolution itself (a desk only ever has one worktree), but import it rather than re-deriving `commonGitDir` if the lock directory ends up needing to agree with the implement lock's. Read `implement-run.ts`'s `publishLock` (hardlink-based, `EEXIST` on a race), `takeGuard` (staleness guard with a two-attempt replace), and `implementLockHeld`/`decodeImplementHolder`/`encodeImplementHolder` in `packages/domain/src/rules/implement-lock.ts` before writing a new one. The continue lock's record almost certainly needs no `agent` field — unlike an implement run, nothing double-forks here — so decide whether to reuse `ImplementHolder` verbatim or add a narrower sibling record, and say which in the PR with the reason.

**A refusal is the end of that action.** Per `CLAUDE.md`'s "The Master Agent Uses The Controllers" and the implement-lock brief's own rule: a continuation that cannot take the lock does not wait, retry, or queue. It returns the existing `loop-alive` refusal shape (409, reason `loop-alive`) — the lock contention reads exactly like the live-loop refusal already does, because to a caller the two causes have the same remedy: ask again once the other run is known to be done.

**Rules carried over unchanged, now from two prior slices:** absent is not false — an unreadable lock holds nothing, but a probe that could not ask is not "dead" (`implementLockHeld`'s `isRecorded`); read the exit code, not the emptiness; a `plot-ask`-style bundle reads the file directly, never `jq` over it. And from `continuation.ts` itself: refused before any write — a refused continuation leaves no prompt file, no appended log, and no removed `.plot-worker.exit`; the lock this slice adds must be acquired (or fail) before any of those writes, not after.

**Style:** a helper you write or rewrite is an arrow (`CLAUDE.md`'s Domain Package rules apply to any new code, not just `packages/domain/**`, for anything you author). A neighbouring `function` declaration in `continuation.ts` or `registry.ts` stays untouched — this is a function-level change, not a file-level rewrite. Comments state interface, not history.

### Done when

The plan's `## Done when` list is absent; the plan's Slices line is the specification: *the start lock, the spawn `'error'` path, the stale pid, the wrapper wait, the freewait leak and one definition of the freewait filename.* Concretely:

- Two concurrent `continueOnDesk` calls against the same worktree: the test drives both through a shared starting line (e.g. both pass their `continueTarget` check before either spawns) and asserts exactly one spawns, the other reads a refusal naming lock contention. It must fail on main — demonstrate the race first, by test, before fixing it.
- A spawn whose `child.on('error', ...)` fires (inject a `sh` binary that does not exist, or a launch stub that emits `'error'` instead of `'exit'`) resolves the function with a `failed` result and leaves no lock behind — assert a second call can then proceed.
- `readDeskPid`'s behavior around a stale pid file is tested at whatever level item 3's decision lands: either a corpus/unit test proving the lock closes the window, or a new freshness check on the reader, with a test that fails without it.
- The freewait filename is defined once; a test (or the existing `check-*.sh` grep, extended if needed) fails if a second literal `.plot-worker.freewait` string is reintroduced in either module. A continuation that stops a free-waiting loop removes the freewait file; a test starts a loop, marks it free-waiting, continues the desk, and asserts the freewait record is gone afterward.
- Every new or changed assertion must fail on an unmodified main — mutate your fix once per test and watch it fail, per `superpowers:verification-before-completion`.

Gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. This branch touches `packages/fleet/src/shared/continuation.ts`, `packages/fleet/src/shared/registry.ts`, `packages/domain/src/adapters/desk/desk-fs.ts`, `packages/domain/src/rules/desk-loop-alive.ts` and their tests, so expect the domain and fleet vitest/typecheck entries and the fleet-side route test (`packages/board/test/unit/continue-route.test.ts`) if the lock's refusal shape changes what that route returns. The suites in the `CI suites` key run in CI on every PR; do not run `pnpm run test:e2e` locally — it is CI's gate, not a local one (see `CLAUDE.md` Testing). Add a changeset for `plot` with the description first and the `bumps:` block last — this is a `bug/` branch, so `patch` unless the fix changes an observable contract. `scripts/check-shell-lines.sh` refuses growth of shipped shell; this slice is expected to touch no `.sh` file, and if that changes, remove an equal number of lines elsewhere in the same change.

### Bookkeeping

Open the PR through the controller once the branch holds a commit:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

Do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line under `### Start and stop` in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/fleet/src/shared/continuation.ts`, `packages/fleet/src/shared/registry.ts` (the `readDeskPid` reader only), `packages/domain/src/adapters/desk/desk-fs.ts`, `packages/domain/src/rules/desk-loop-alive.ts`, and their tests — plus a new lock module if the continue lock does not fit as an addition to `implement-run.ts` (decide and say which in the PR).

`bug/a-failed-continue-leaves-its-desk-whole` waits on this branch and holds the manifest-ordering fix (manifest written last, `no-manifest` refused before the stop, the manifest restored on a stop timeout, the `warning` field) in the same two files, `continuation.ts` and `continue-route.test.ts` — leave those changes to it; do not pre-empt its slice by reordering the manifest write here. The continuation-semantics slices (`bug/a-continuation-obeys-the-limits`, `bug/an-unstarted-continue-resumes-no-stranger`) are a separate wave with no `waits:` on this branch and are not started; they touch `continue.ts`'s limit checks and `resumeIdFromTranscript`, not the lock. If you find something the plan did not anticipate, report it rather than improvising outside scope.
