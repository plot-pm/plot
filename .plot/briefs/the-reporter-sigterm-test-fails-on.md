## Implementation brief — the-reporter-sigterm-test-fails-on

- **Plan (canonical):** docs/plans/2026-11-02-the-reporter-sigterm-test-fails-on.md on main
- **Approved:** 2026-11-02, Jan Wloka, plan-PR #3039 merged
- **Branch:** `bug/the-reporter-sigterm-test-fails-on` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** plan-review channel `pr`; the PR carries the A/B counts

One slice, nothing waits on it. Issue #3033.

### What to build

`reporterShell` in `packages/fleet/src/shared/continuation.ts` (about lines 855-883) forks the reporter as `( trap '' TERM; … ) &`. The ignore is set inside the child, after the fork. A group `SIGTERM` that lands first ends the reporter with no finding, which fails `reporterShell — … survives a group SIGTERM and reports 143 (20 runs)` (`continuation.test.ts:736`) and, in production, loses the desk's `WorkerMonitor` finding after `plot-dispatch.sh --stop`. Measured by the panel on macOS `/bin/sh`: 34/600, 7/300, 5/200 misses; `/bin/dash` under load: 13/150.

The change is one string: add `trap '' TERM; ` in the outer shell after `agent=$!; printf … > "$PLOT_PID_FILE"; ` and before the reporter's `( `. The reporter then inherits the ignored disposition at fork. The plan is canonical; this is orientation.

### Settled decisions — do not re-derive

- **Fix production code, not the test rig.** The reporter writes nothing before its trap, so a readiness signal in the rig has nothing to wait on. A marker would put test instrumentation in the fleet start path.
- **The 5 s bound is not the cause.** The failing runs took 5709 ms and 5854 ms; a passing run takes about 45 ms per iteration. A dead reporter writes nothing at any bound. Do not raise it.
- **Delivery order across the group is not the cause.** An ignored disposition cannot be skipped by order.
- **The ignore never comes before `agent=$!`.** An earlier `trap '' TERM` makes `( ${cmd} )`, and with it `plot-worker-loop.sh` and `claude`, start with `SIGTERM` ignored, so a group stop ends nothing. `plot-dispatch.sh:1450-1455` and `:1507` state the same rule for the worker wrapper.
- **Keep the reporter's inner `trap '' TERM`.** It is redundant after the fix and documents the intent.
- **Keep the 20-run test unchanged:** its `ready` wait, `5_000` bound, 20 iterations and every assertion. After the fix the window is zero by construction.
- **Do not claim the reporter always reports a group `SIGTERM`.** The agent subshell has its own early window before its `143` trap (2/60 under dash, 2/200 and 3/200 on macOS). It needs its own issue; do not fix it here.

### Done when

The plan's `## Slices` line and `### Proof` section are the specification:

- Structural test beside "holds no sleep and no absolute path between the open and the tail" (`continuation.test.ts:653-662`): in `reporterShell(cmd)`, an outer `trap '' TERM;` appears after `agent=$!` and before the reporter's `( trap '' TERM;`, and no `trap '' TERM` appears before the agent subshell's `(`. It must fail on `origin/main`'s string — run it against the old string to prove that.
- Behavioural test that the agent's command still dies on a group `SIGTERM`: `cmd` writes its own pid (as in the SIGKILL test at `continuation.test.ts:691-707`); after the group `SIGTERM` that process is dead and the exit file reads `143`. It catches a `trap '' TERM` placed before the agent fork.
- Update the TSDoc sentence near `continuation.ts:848-849`: the reporter starts with `SIGTERM` already ignored, and the ignore must follow `agent=$!`.
- The PR records an A/B of the group-`SIGTERM` sequence, N of at least 300, original string against fixed string, on macOS `/bin/sh` and Linux `dash` (e.g. `debian:stable-slim`). The original must miss at least once and the fixed must miss zero times. If the original never misses on one shell, say so and keep the other shell's numbers. One green CI run is not the proof.

Plus: a changeset (patch, package `plot`; description first, `bumps:` block last) and no generated bundle in the diff. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; CI runs the suites in `CI suites`. Do not run `test:e2e`. The slice touches no `.sh` file, so `scripts/check-shell-lines.sh` is not in play.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists. Functions you write are arrows.

### Scope guard

Owned: `packages/fleet/src/shared/continuation.ts`, `packages/fleet/test/unit/continuation.test.ts`, one changeset. Do not touch `plot-dispatch.sh`, `plot-worker-loop.sh` or the agent subshell's trap. Other slices in flight are not known to touch these files.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
