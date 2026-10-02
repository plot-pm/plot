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
- **Started:** 2026-10-02, Jan Wloka, `bug/the-scan-time-is-measured`
- **Started:** 2026-10-02, Jan Wloka, `bug/the-scan-drops-its-largest-cost`

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

### The scan time is measured (Branch: bug/the-scan-time-is-measured, PR: #1174)

The board-shaped scan timed on `origin/main` and split into host, git, shell and wait; the table goes on #1017 and into Notes. No shipped file changes. <!-- builds: a timed attribution of the fleet scan's wall time -->

### The scan drops its largest cost (Branch: bug/the-scan-drops-its-largest-cost, PR: #1196) <!-- waits: bug/the-scan-time-is-measured -->

Removes the one cost slice 1 names, if it holds 30% of the median or the median is 45 s or more; deferred otherwise. A decision moves into `packages/domain`; shell overhead is fixed in place.

## Notes

### Slice 1 measurement — the scan's wall time, split

Every run is `plot-fleet-scan.sh --stream` from a worktree of `origin/main` at **`03fd1c8b`**, 26 plans, 46 tracked branches. That commit **includes** `bug/the-merge-subject-is-one-rule` (merged as PR #1159, commit `86b66628`); the brief recorded it as in flight and unmerged, and it had merged before the first run started.

`PLOT_TERMINAL_CACHE` is set as `fleet.ts:3318` sets it: empty for the cold run, and for each later run the previous run's `terminal:` stderr lines with the prefix stripped.

| Run | Cache | Wall | CPU (user+sys) | Wait | Host | — of which `pr-state` | `pr-state` share | Host calls | Load before→after |
|---|---|---|---|---|---|---|---|---|---|
| 1 cold | `''` | 398.4 s | 110.6 s | 287.8 s | 238.7 s | 226.7 s (39 calls) | **56.9%** | 42 | 22.5 → 16.0 |
| 2 warm | 3 entries | 401.4 s | 110.9 s | 290.5 s | 234.4 s | 216.2 s (39 calls) | **53.9%** | 42 | 14.7 → 18.9 |
| 3 warm | 3 entries | 1768.0 s | 111.8 s | 1656.2 s | 1090.7 s | 1069.2 s (37 calls) | **60.5%** | 40 | 24.9 → 56.7 |
| 4 warm | 3 entries | 2300.1 s | 110.9 s | 2189.2 s | 1415.0 s | 1301.2 s (36 calls) | **56.6%** | 39 | 67.9 → 91.1 |
| 5 warm, `PS4` traced | 4 entries | 3547.0 s | 118.9 s | 3428.2 s | 2037.3 s | 1936.3 s (36 calls) | **54.6%** | 39 | 88.7 → 53.8 |

**The four parts, from run 5's `PS4` trace** (`BASH_XTRACEFD`, so the trace never mixed with the `terminal:` lines the board reads):

| Part | Time | Share of traced span |
|---|---|---|
| Host (`plot-host.sh`) | 2019.5 s | 57.0% |
| Git | 153.7 s (149 calls) | 4.3% |
| Shell (the scan's own bash) | 1377.7 s (430,104 gaps) | 38.9% |
| Traced span | 3545.6 s | — |

The parts add up: 2019.5 + 153.7 + 1377.7 = 3550.9 s against a 3545.6 s span, a +0.15% remainder from attributing each gap to the line that opened it. **The two instruments agree independently** — the host shim timed 2037.3 s from outside the calls, the trace 2019.5 s from inside the scan, a 0.9% difference.

**Wait is the whole story, and it is not idleness.** CPU was 110.6–118.9 s in every run while wall ranged 398 s to 3547 s. The scan's own work is constant; what grows is time blocked on a child. 57% of that block is one helper.

### The largest single cost

**`plot-host.sh pr-state` at `plot-fleet-scan.sh:1167`, one call per branch** — 36–39 calls per run, 54–61% of wall in all five runs. The share is flat across a 6× load range (15 → 91), so neither load nor host latency explains it alone, as the plan required the split to show rather than argue.

The other host calls are small by comparison: the two `pr-list` calls (`:882`, `:898`) cost 11.6 s and 16.5 s on the two low-load runs, and `backend` (`:561`) 0.5–1.7 s. Per-call `pr-state` cost was 5.54 s and 5.81 s average at load 15–22, and 36.14 s average (126.79 s worst) at load 68–91.

**The terminal cache cannot reduce this count on this estate.** Warm run 2 made the same 42 host calls as cold run 1 at the same wall time. `terminal_learn` (`plot-fleet-scan.sh:1283`) caches only `MERGED` and `CLOSED` by design, and the estate's 46 tracked branches resolved to 18 `open`, 17 `blocked`, 6 `wip`, 2 `claimed` and **3 `merged`** — so the map held 3 entries against 39 asks. The cache behaves exactly as written; this population is not the one it answers.

### The largest shell cost, reported and not acted on here

`plan_meta_index_of` (`plot-fleet-scan.sh:2937-2938`) — **294.4 s over ~345,000 trace gaps**, the linear scan over `plan_meta_files` the Motivation already named. It is the largest shell line by a wide margin; the next are the two `node` bundle calls at `:3532` (123.0 s, `plot-branch-state.mjs`) and `:3925` (77.5 s, `plot-verdicts.mjs`), then `json_str`'s `sed` at `:3566` (47.4 s over 1509 gaps). These figures carry the trace's own inflation and are shares, not wall times.

**The estate parse is one row and is not a suspect**, as the plan settles: `plot-plan-meta.sh` accounted for **24.5 s over 14 gaps** on the traced run at load 89. No cache is proposed.

### Verdict

**Both thresholds hold.**

- **One cost at 30% or more of the median wall: HOLDS.** `pr-state` is 60.5% of the median warm wall, and 54–61% in every individual run.
- **A median wall of 45 s or more: HOLDS**, but this number must not be read as the board's. The median warm wall is 1768.0 s, inflated by machine contention — up to nine foreign `plot-fleet-scan.sh` processes, a live board server and a `plot-registryd --start-agents` ran throughout, at load 15 to 101. The plan's own 2026-10-01 baseline of 56.08 s is the board's quiet figure. **Threshold A is the load-robust finding and is the one wave 2 should rest on.**

Wave 2's named cost is therefore the per-branch `pr-state` call at `plot-fleet-scan.sh:1167`. Deciding which rule owns that call's frequency is wave 2's, not this slice's.

### What this slice did not anticipate

- **A `git` shim is too expensive to use for wall time.** Wrapping `git` in a bash-5 timing shim cost ~198 ms per call (25.57 s against 5.83 s over 100 bare calls, a 4.4× inflation) and pushed an `--offline` scan past 120 s against a 9.7 s baseline. The git part comes from the `PS4` trace instead, which is the method the brief prescribes. Bare `git` on this machine at load 15 costs **58 ms per invocation** in process start alone.
- **A measurement cannot get a quiet machine here.** Runs 3-5 ran against a saturated fleet and are reported at their own load rather than averaged into the low-load pair. The share held anyway, which is the result.
- **`plot-host.sh` could not be shimmed through `PATH`.** The scan calls it as `"$script_dir/plot-host.sh"`, so the timing wrapper replaced that file in the throwaway worktree and delegated to a sibling copy — the helper resolves its own siblings through `BASH_SOURCE`, so a copy under `/tmp` broke it, which is the brief's "real checkout, not a copy" trap one level down.

No shipped file changed. The instrumentation lived in a detached worktree and in `/tmp`, and is not in this diff.

- **Replaces the rejected `a-parsed-plan-joins-the-index`** (`docs/plans/2026-09-26-a-parsed-plan-joins-the-index.md`). That plan proposed a content-keyed parse cache against a 32 s parse cost. The panel measured the batched parse at 481 ms (`plot-fleet-scan.sh:2851`, one invocation for all plans) and found most of an `--offline` scan in the script's own bash. This plan proposes no mechanism. It measures the board's own call shape, with the host, and makes the second slice conditional on that result.
- The two readings in Motivation are one run each, at load 22-30, on two commits 30 minutes apart. They show the size of the gap between `--offline` and `--stream`, not its cause.
