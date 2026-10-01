# A scan says where its time goes

> The board's fleet scan took 56 s against a 90 s budget on 2026-10-01, and the same scan without the host took 9.7 s. Four explanations of #1017 were proposed and each was wrong. This plan measures where the time goes on `origin/main` first, and changes code only where that measurement names one cost.

## Status

- **State:** Approved
- **Approved:** 2026-10-02, jwloka, in-session
- **Type:** bug
- **Issue:** #1017
- **Sprint:** the-fleet-runs-through-its-limits
- **Review:** in-session
- **Impl:** own branches

## Changelog

- The board's fleet scan spends less time on the one cost a timed measurement attributed the largest share to. If no cost holds that share, nothing changes and #1017 closes on the measurement.

Board impact: the board runs this scan on every pulse (`packages/board/src/server/fleet.ts:3293`, `['--stream']`) under `FLEET_SCAN_BUDGET_MS = 90_000` (`fleet.ts:1093`). No payload or schema change.

## Motivation

### Measured 2026-10-01 on `origin/main`

| Shape | Commit | Wall | user + sys | Plans | Load avg |
|---|---|---|---|---|---|
| `plot-fleet-scan.sh --offline` | `4fe88a8d` | 9.68 s | 4.31 + 3.94 s | 11 | 22-30 |
| `plot-fleet-scan.sh --stream` (the board's shape) | `a651aff5` | 56.08 s | 13.35 + 9.92 s | 16 | 26-29 |

The streaming scan used 23.3 s of CPU in 56.1 s of wall time. The other 32.8 s is time the scan waited: on the host, on git, or on a CPU at load 28. These two runs do not separate those three.

### What is already ruled out

- **The plan parse.** `parse_plan_estate` (`skills/plot/scripts/plot-fleet-scan.sh:2851`) passes every plan file to `plot-plan-meta.sh` in one invocation, measured at 481 ms for 350 plans by the panel on `a-parsed-plan-joins-the-index`.
- **Machine load as the only cause.** The issue records load 52 → 12 with the timeout still present.
- **Host latency as the only cause.** The issue records `backend` at 1 s and `pr-list` at 3-4 s.

### What the earlier profile found, and why it is not enough

A comment on #1017 traced one `--offline` scan with `PS4` carrying `EPOCHREALTIME` and `LINENO`: about 125,000 builtin operations for 27 plans, no line above 12%. The named hot spots still exist on `origin/main` at new lines:

- `plan_meta_index_of` scans `plan_meta_files` linearly for each lookup (`plot-fleet-scan.sh:2935-2941`).
- `ref_plan_file` runs `basename "$p"` twice on one value (`plot-fleet-scan.sh:2651-2652`).
- `json_str` starts one `sed` per string (`plot-fleet-scan.sh:3565-3568`).
- `ref_mode_of` pipes `$PLAN_MODES` through `awk` per path (`plot-fleet-scan.sh:2550-2551`).

That profile was `--offline`, on another commit, and its wall time was 21-37 s. The `--offline` scan now takes 9.7 s, so the bash share it measured is smaller today. The board does not run `--offline`. It runs `--stream` with the host, and `plot-fleet-scan.sh:882` and `:898` make two `pr-list` calls per scan. No measurement has split a board-shaped scan into shell, git, host and wait.

## Design

### The rule

**No code changes until a timed, board-shaped scan on `origin/main` names the cost it removes.**

### Slice 1 measures

The measurement runs `plot-fleet-scan.sh --stream` from a checkout of `origin/main`, with `PLOT_TERMINAL_CACHE` set as the board sets it (`fleet.ts:3318`). It runs at least three times and records the load average and the commit for each run.

It splits each run's wall time into four parts:

1. **Host.** Each `plot-host.sh` call, timed from the scan's own clock (`EPOCHREALTIME` around the calls at `plot-fleet-scan.sh:882` and `:898`, and any other host call the trace finds).
2. **Git.** Each `git` invocation, timed the same way.
3. **Shell.** The scan's own bash, per section, from a `PS4` trace with `EPOCHREALTIME` and `LINENO`, the method the #1017 profile used.
4. **Wait.** Wall time minus CPU time, reported beside the load average, so a run at load 28 can be compared with a quiet run.

The instrumentation lives in the measurement and is not committed. The slice commits no script and changes no shipped file. It posts the table on #1017 and records it in this plan's Notes, with the commit, the load and the median of each part.

### Slice 2 acts only on a named cost

Slice 2 runs if slice 1 finds either of these:

- one cost (one host call, one git call site, or one shell section) holds **30% or more** of the median wall time, or
- the median wall time is **45 s or more**, half of the 90 s budget.

If neither holds, slice 2 is deferred with the measurement as its reason, and #1017 closes on that measurement.

If slice 2 runs, it removes the largest named cost, and the cost decides the fix:

- **A decision made in shell** (for example a classification over plans) moves into a rule in `packages/domain/src/rules/` and is reached through a shipped bundle, as `docs/shell-and-domain.md` requires. The scan asks the rule; it does not keep a second copy.
- **Shell overhead with no decision in it** (a linear lookup, a fork per value) is fixed in place, in the same function, with no new script.
- **A host call** goes to the rule that already owns that call's frequency. This plan adds no second cadence. `a-pr-refresh-reads-the-history-once-a-day` (#1087) owns the board's full PR read; a scan listing is a different call and the slice names which rule it follows.

### What this does NOT do

- **It does not cache plan parses.** The parse is 481 ms, and the panel rejected that design.
- **It does not raise `FLEET_SCAN_BUDGET_MS`.** A budget that moves to fit the scan measures nothing.
- **It does not add a `plot-*.sh` script.**

## Done when

- Slice 1: a table on #1017 gives, for at least three board-shaped runs on a named `origin/main` commit, the wall time, the CPU time, the load average, and the host, git, shell and wait parts, with the largest single cost named.
- Slice 2, if it runs: the median board-shaped wall time falls by at least the share slice 1 attributed to the removed cost, measured the same way at a comparable load, and the scan's output is unchanged for the same estate (`--json` compared before and after).
- Slice 2, if deferred: its branch line carries `deferred:` with the measurement, and #1017 is closed with the same numbers.

## Slices

### The scan time is measured (Branch: bug/the-scan-time-is-measured)

The board-shaped scan timed on `origin/main` and split into host, git, shell and wait; the table goes on #1017 and into Notes. No shipped file changes. <!-- builds: a timed attribution of the fleet scan's wall time -->

### The scan drops its largest cost (Branch: bug/the-scan-drops-its-largest-cost) <!-- waits: bug/the-scan-time-is-measured -->

Removes the one cost slice 1 names, if it holds 30% of the median or the median is 45 s or more; deferred otherwise. A decision moves into `packages/domain`; shell overhead is fixed in place.

## Notes

- **Replaces the rejected `a-parsed-plan-joins-the-index`** (`docs/plans/2026-09-26-a-parsed-plan-joins-the-index.md`). That plan proposed a content-keyed parse cache against a 32 s parse cost. The panel measured the batched parse at 481 ms (`plot-fleet-scan.sh:2851`, one invocation for all plans) and found most of an `--offline` scan in the script's own bash. This plan proposes no mechanism. It measures the board's own call shape, with the host, and makes the second slice conditional on that result.
- The two readings in Motivation are one run each, at load 22-30, on two commits 30 minutes apart. They show the size of the gap between `--offline` and `--stream`, not its cause.
