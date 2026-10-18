## Implementation brief — fleetd-tick-stop-and-escalation-defects (slice: fleetd-retries-usage-limit-brief)

- **Plan (canonical):** `docs/plans/2026-10-17-fleetd-tick-stop-and-escalation-defects.md` on `main`
- **Issue:** #1716 (folded into tracking issue #1846)
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1965 merged
- **Branch:** `bug/fleetd-retries-usage-limit-brief` (base: `main`)
- **Ends as:** one PR to `main`, opened with `../plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review, CI green)

This slice is independent of the plan's other five — it touches only `packages/fleet/src/shared/brief-ask.ts`, `auto-dispatch.ts` and `packages/domain/src/rules/`. It does not wait on any other slice of this plan.

### What to build

fleetd's `maybeAutoDispatch` (`packages/fleet/src/shared/auto-dispatch.ts`) asks a one-shot "Brief command" run to write a slice's hand-off brief when `findMissingBriefs` reports it absent on `origin/<main>`. Once asked, the branch goes into `briefsAsked: Set<string>` and `maybeAutoDispatch` never asks again for that branch until `outstandingAsks` (`packages/domain/src/rules/auto-dispatch.ts`) drops it — which happens only when the brief lands on `origin/main` or the branch leaves the candidate list entirely.

When the Brief command's agent run ends because it hit the account's usage limit, nothing distinguishes that from any other failure: `askForBrief`'s `onEnd` callback (`brief-ask.ts:132-134`) does `if (record.code !== 0) console.log(...)` and returns. The branch stays latched in `briefsAsked` forever. fleetd logs `skipping ... no brief on origin/main` on every subsequent pulse, including long after the reset time has passed — issue #1716 measured 94 minutes with zero re-asks, confirmed by grepping the daemon's own log for a second `askForBrief` call on that branch and finding exactly one. The daemon does not crash and does not stall on anything else; it simply never retries this one slice's brief, so the slice sits unimplementable until a human notices and restarts fleetd (which empties `briefsAsked` as a side effect — the only thing that currently un-sticks it).

This is a different code path from the one that already retries on a usage limit. The per-slice worker loop (`packages/fleet/src/server/entry/worker-loop.ts:1670-1678`) reads the agent run's `end.answer === 'wait'`, calls `deps.ports.desk.writeLimitedRecord(worktree, exit.reset.epoch, exit.reset.iso, ...)`, sleeps to `reset epoch + limitMarginSeconds`, then `clearLimitedRecord` and resumes the same slice. The Brief command has no equivalent: it is a one-shot, fire-and-forget spawn with no worktree and no desk, started from inside the board process on a ~5s pulse cadence, not a shell loop that can block in a sleep.

### The decisions this brief settles — do not re-derive them

**The reset time is being computed correctly today; it is discarded, not missing.** `boardRunEnd` (`packages/domain/src/rules/board-run-end.ts:78-81`) already matches `case 'wait':` and has `end.resetEpoch` in hand — it formats it into a human-readable `line` (`` `the ${role} run stopped at the account's usage limit, which resets at ${new Date(end.resetEpoch * 1000).toISOString()}` ``) and returns it via the shared `failure()` helper, which hardcodes `{ code: 1, outcome: null, written: null }`. `BoardRunRecord` (`board-run-end.ts:50-59`) has exactly four fields — `code`, `line`, `outcome`, `written` — none of which carry a machine-readable reset time. So the fix is not "go find the reset time"; it already exists one call frame above where it is needed and is thrown away. Do not add a second usage-limit detector that re-parses the harness's output — that rebuilds what `boardRunEnd` already does correctly for every other board role (`approve`, `deliver`, `idea`, etc.), and a second parser is a second place to get it wrong.

**Reuse the desk port's reset bookkeeping; do not reuse `worker-loop.ts`'s sleep.** `packages/domain/src/ports/desk.ts:158-196` (`writeLimitedRecord` / `clearLimitedRecord`, filesystem impl `packages/domain/src/adapters/desk/desk-fs.ts:221-230`, test fixture `desk-fixture.ts:98-106`) is the existing, tested mechanism for "remember a reset epoch against something, and clear it later." It is keyed to a worktree today because its only caller is the worker loop. The Brief command has no worktree — it runs from `opts.repoRoot` directly (`brief-ask.ts:126`) — so this slice needs either a second key scheme for the same port (keyed by branch or plan slug instead of worktree path) or a small sibling store, not a blocking sleep: `maybeAutoDispatch` runs once per pulse and must return promptly, the same reason `askForBrief` is fire-and-forget in the first place (see that file's own "ASK, DO NOT AWAIT" doc comment). A sleep inside a pulse would hold up every other branch's dispatch decision behind this one slice's wait, which is exactly the failure mode `askForBrief`'s doc comment already rejects for the ask itself.

**The retry condition is `now >= resetEpoch`, not `now >= resetEpoch + margin`.** `worker-loop.ts` adds `PLOT_LIMIT_MARGIN_SECONDS` (default 60) before resuming a live prompt process, because resuming too early wastes a started harness process. The Brief command's retry cost on waking too early is just one more spawn attempt that itself ends in `wait` again with a fresh (or same) reset epoch — cheap, and already bounded by the pulse cadence. Carrying the margin over is not wrong, but do not treat it as settled; if you add it, say why in the commit, because nothing here measured whether it matters for a one-shot spawn the way it matters for a long-running prompt.

**`briefsAsked` needs a third state, not a boolean.** Today a branch is either in the set (asked, blocked until the brief lands) or not (free to ask). A `wait` ending needs a middle state: asked, blocked until `<epoch>`, then free to ask again — and if the re-ask also ends in `wait`, replace the epoch rather than compounding waits. `outstandingAsks` (`packages/domain/src/rules/auto-dispatch.ts`) is the pure domain function that currently decides what stays in the set; extend its decision (and its signature) rather than filtering `briefsAsked` a second way in `auto-dispatch.ts` itself — the whole point of that function existing is that `maybeAutoDispatch` contains no judgment of its own about what counts as outstanding.

**This is fleetd-internal state, not a persisted index.** Per `CLAUDE.md`'s "A Decision Reads The Index" section, `briefsAsked` is explicitly documented as in-memory, per-daemon, with no state file — "a restart loses it... that is the same recovery `plot-registryd.mjs` relies on." A reset-time extension to it follows the same rule: it lives in the daemon's memory, not in `.plot/state/`. A fleetd restart before the reset time losing track of the wait and re-asking immediately is acceptable — it is strictly better than today's "never asks again," and matches how a restart already clears the stuck latch by hand.

### Done when

The plan's `## Design` names this as slice 5, "Usage-limit retry — #1716," with no further `## Done when` list of its own (the plan is a grouping document; the per-slice specification is this brief). Build to:

- A `wait`-ending Brief-command run is distinguished from a plain failure (currently both just log a line and drop the record).
- The reset epoch from that `wait` ending reaches a place `maybeAutoDispatch`'s next pulse can read.
- The next pulse after `now >= resetEpoch` re-asks the Brief command for that branch, rather than skipping it forever.
- A pulse before the reset time does not re-ask (no busy-spin spawning the harness every 5 seconds).
- A brief that lands (by any means — the re-ask succeeding, or a human writing it by hand) still clears whatever wait-state was recorded, the same way `outstandingAsks` already drops a branch once its brief exists.

Add a test to `packages/board/test/unit/auto-dispatch-brief-ask.test.ts` for the `wait`-ending case before writing the fix — grep confirms that file and `brief-ask-log.test.ts` currently assert nothing about a `wait` ending, and `packages/domain/test/rate-limit-entry.test.ts` covers only the worker-loop's limited-record logic. This is the gap a naive "it already works, worker-loop handles waits" read would miss: that test file proves worker-loop's path, not this one.

Plus: run `nvm use` (Node 24) first. Run `node ../plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — the related domain/board test and typecheck commands, plus the gate scripts. The suites in the `CI suites` config key (`pnpm run test:e2e`, `test:contracts`, `test:board`, the domain coverage run, `node --test test/reconcile/*.test.mjs`) run in CI on every PR; do not run the full list locally, and do not run `test:e2e` locally at all (CI's job, not a local one per `CLAUDE.md`'s Testing section).

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grows past its merge base. This slice is TypeScript-only (`packages/fleet/src/shared/`, `packages/domain/src/`) and should touch no `.sh` file, so this gate should pass without any offsetting removal — if a change here does end up touching shell, say in the commit why, and what shell elsewhere was removed to pay for it.

### Bookkeeping

When the PR is created (via `../plot/scripts/plot-open-pr.sh`, never `gh pr create`), append `→ #<number>` to this branch's line in the plan's `## Slices` section:

```
- `bug/fleetd-retries-usage-limit-brief` — re-ask a brief that ended at the usage limit after its reset time → #<number>
```

Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/fleet/src/shared/brief-ask.ts`, `packages/fleet/src/shared/auto-dispatch.ts`, and whatever new or extended domain rule under `packages/domain/src/rules/` and `packages/domain/src/ports/` the retry decision needs (likely touching `auto-dispatch.ts`'s domain-side `outstandingAsks` and the desk port). It does not own `packages/fleet/src/server/entry/worker-loop.ts` — read it for the retry pattern, do not change it; its own wait-handling is already correct and belongs to a different plan (`docs/plans/2026-10-01-a-usage-limit-is-not-a-broken-prompt.md`, issue #1141).

The plan's five sibling branches touch disjoint areas verified at dispatch time: `bug/fleetd-tick-guard-and-escalations` (tick guard, escalation memory), `bug/fleetd-stop-starts-no-agent` (stop path), `bug/fleetd-once-and-channel-output` (`--once` output, channel retry), `bug/fleetd-unit-harness-findings` (#1589 review findings), `bug/refused-hold-names-its-reason` (board + domain refusal naming). None of them touch `brief-ask.ts`, `board-run.ts`, `board-run-end.ts` or the desk port, so this slice should collide with none of them at merge time — but that was verified by reading the plan's own grouping in `## Design › Approach`, not by reading their diffs, since none of those branches had a PR open yet at the time this brief was written.

If you find the desk port's worktree-keyed shape cannot be cleanly adapted to a branch/slug key, or that `outstandingAsks`'s signature change ripples further than expected, report that rather than improvising a parallel tracking structure outside the domain layer.
