## Implementation brief — a-supervisor-that-stopped-ticking-is-not-running (wave 1: The status says when it last ticked)

- **Plan (canonical):** `docs/plans/2026-09-24-a-supervisor-that-stopped-ticking-is-not-running.md` on `main`
- **Approved:** 2026-09-24, in-session review after panel (round 1)
- **Branch:** `bug/the-status-says-when-it-last-ticked` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review, CI green)

Wave 2, `bug/the-board-shows-the-tick-age`, waits on this branch. It parses what this slice prints, so the output shape chosen here is the contract wave 2 reads.

### What to build

On 2026-09-23 `plot-fleetctl.sh --status` printed `supervisor: running (pid 3260)` while `.plot/logs/registryd.log` had not been written for 25 hours. The last tick in that log recorded `cost=2478705ms` (41 minutes, against a normal 13–49 s). The running arm checks two facts only: the label is loaded and a pid exists. It never looks at the log.

The fix is one reading in one more arm. The `LOADED, NOT RUNNING` arm (`skills/plot/scripts/plot-fleetctl.sh:379-385` on main at dispatch) already reads the log's mtime and prints:

```
  last tick: <N>s ago (evidence, not the verdict — a busy tick writes at most every 60s)
```

Print the same line in the `running` arm (`:355-357`), directly after `supervisor: running (pid …) — $LABEL`. Extract the mtime read into a helper that both arms call, so the two arms cannot drift. A second copy of `stat -f %m … || stat -c %Y …` is the drift this repo keeps measuring. The plan is canonical; this brief is orientation.

### Decisions the plan settles — do not re-derive them

**Evidence, never a verdict.** The line prints no threshold, no warning word and no `STALE`. A healthy supervisor between ticks has not written for up to 60 s, and this repo has measured 49 s ticks. A threshold that calls 90 s dead is wrong on a busy estate. A threshold generous enough to be safe would not have caught 25 hours sooner than a person who reads the number. Wave 2 puts the staleness judgement in the **domain** with unit tests, not in shell.

**`summary:` keeps `supervisor=up install=running`, whatever the tick age.** The state word answers *is a process behind the label*, and that was true. If liveness folds into it, one word answers two questions, and that is the defect the three-state split at `:370` removed. `rules/supervisor-reading.ts` reads the exit code and the `summary:` line as its contract. The exit code stays 0 for a running supervisor.

**No heartbeat file.** A heartbeat file duplicates what the log already holds. `packages/board/src/server/supervisor.ts:49` rejects exactly that: a memo that outlives the tick makes the daemon hold state, and the design's `kill -9` costs one tick and nothing more. The log's mtime costs nothing and needs no contract.

**No restart, no repair.** `--status` starts nothing. That property is what lets it report an absence at all.

**The causal story in the plan's first draft is refuted. Do not rebuild it.** The idle agents were free and had no claimable work (547 ticks with `idle=3`, `no-free-agent=0` on 986 of 987). The fix does not claim that a stale supervisor starved agents. Keep comments and the changeset to the measured fact: `running` over a 25-hour-old log.

**The wave 2 field is not built here.** Wave 2 decides how the tick age reaches the `summary:` line. This slice changes no machine-read field. If carrying a field here looks necessary, report it instead of adding it.

Rules carried over from related work:

- **Absent is not zero.** No log file means no `last tick:` line. It never means `0s ago`. The existing arm already guards with `[ -f "$tick_log" ]`, and its `|| echo "$now"` fallback prints `0s` when `stat` fails on an existing file. Keep that behaviour identical in both arms and do not widen it.
- The exit code is the contract. Prose is not.

### Done when

The plan's `### Done when` list is the specification. Assertions that exist because a naive implementation passes without them:

- **A stale log in the running arm prints the line with a large age.** Backdate the log's mtime (`fs.utimesSync`) by hours and assert a value in that range. A fresh-log-only test passes when the value is wrong, for example when `touched` falls back to `now`.
- **The same stale-log run still matches `^summary:.*supervisor=up install=running$` and exits 0.** This catches a fix that "helpfully" downgrades the state.
- **No log file prints no `last tick:` line** in the running arm. This catches a `0s ago`.
- **The loaded-not-running arm still prints its line** after the helper extraction. Extend or keep its test (`test/reconcile/fleetctl.test.mjs:804`) so that the refactor cannot drop it.

Tests go in `test/reconcile/fleetctl.test.mjs`. Reuse its seams: `sandbox`, `fakeHome`, `stubPlatform(box, { loaded: true })` (emits pid 4242), and `run`. See the case at `:778` for the running arm. These cases run on CI through the `PATH` seam. The log lives at `<sandbox root>/.plot/logs/registryd.log`.

Plus the repo gates:

- `nvm use` (Node 24) and `corepack pnpm` if homebrew pnpm crashes
- `pnpm test`
- `pnpm run test:contracts`, which includes `fleetctl.test.mjs`
- no board artifact rebuild: this slice touches no `packages/` source
- **not** `pnpm run test:e2e`, which is CI's gate
- a changeset: `'plot': patch`, description first, `bumps:` block last, `plan: docs/plans/2026-09-24-a-supervisor-that-stopped-ticking-is-not-running.md`, bump `plot-fleet: patch`

Update `skills/plot-fleet/SKILL.md` where it describes `--status` output, if it lists the running arm's lines.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh`. Do **not** use `gh pr create`.
- When the PR exists, append `→ #<number>` inside this slice's wave heading in the plan on `main`: `(Branch: bug/the-status-says-when-it-last-ticked, PR: #N)`. Make that edit from a detached scratch worktree on `origin/main`, not in the shared main checkout.
- No project board is configured, so no board status is set.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-fleetctl.sh`: the `--status` running arm and the extracted tick-age helper
- `test/reconcile/fleetctl.test.mjs`: new `--status` cases
- `skills/plot-fleet/SKILL.md`: the `--status` description, if it needs a line
- one `.changeset/*.md`

This branch does not touch `packages/board/**` or `packages/domain/**`. Wave 2 owns them.

In flight at dispatch (2026-09-24):

- `bug/the-unload-is-verified-to-a-bound` (plan `a-stop-that-reports-failure-does-not-exit-zero`, Approved, no remote ref yet) edits the **`--stop`** arm of the same `plot-fleetctl.sh`, adds tests to the same `fleetctl.test.mjs` and amends `skills/plot-fleet/SKILL.md:191`. Different arms, so a conflict is at most textual. Rebase onto whichever lands first and keep both.
- No other remote branch changes `plot-fleetctl.sh` or `supervisor-reading.ts`. This was checked against every `origin/*` ref at dispatch.

Out of scope, named in the plan: `--once` printing the previous tick's age (an open question for a later caller), the cause of the 41-minute tick, and the agent bound.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
