## Implementation brief — a-scan-says-where-its-time-goes (wave 1: The scan time is measured)

- **Plan (canonical):** `docs/plans/2026-10-01-a-scan-says-where-its-time-goes.md` on `main`
- **Issue:** #1017
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/the-scan-time-is-measured` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`. The PR carries the plan's Notes entry and nothing else.
- **Review of the code:** per repo convention (PR review, CI green)

**Wave 2, `bug/the-scan-drops-its-largest-cost`, waits on this slice.** It runs only if this slice's table meets one of the plan's two thresholds. This slice decides its input, so the table must name the largest single cost and say which threshold holds, if any.

### What to build

A measurement, not code. On 2026-10-01 the board-shaped scan (`plot-fleet-scan.sh --stream`) took 56.08 s wall against `FLEET_SCAN_BUDGET_MS = 90_000` (`packages/board/src/server/fleet.ts:1093`), with 23.3 s of CPU. The `--offline` scan took 9.68 s. No reading has split the board's shape into host, git, shell and wait. This slice produces that split:

1. Check out `origin/main` at one commit in a worktree, and name that commit in every row of the table.
2. Run `plot-fleet-scan.sh --stream` at least three times, the way the board runs it (see the cache rule below). Record the wall time, user + sys, and the load average for each run.
3. Split each run's wall time into **host**, **git**, **shell** (per section) and **wait** (wall minus CPU).
4. Post the table on #1017 and add it to the plan's `## Notes`, with the median of each part, the largest single cost, and which slice-2 threshold holds: one cost at **30% or more** of the median wall, or a median of **45 s or more**.

The plan is canonical. This brief records the decisions it settles and the traps the measurement has.

### Decisions the plan settles — do not re-derive them

**No shipped file changes.** The instrumentation stays out of the commit. The plan forbids a new `plot-*.sh` script, and slice 1 changes no script at all. The PR diff is the plan's Notes entry. A diff that touches `skills/` or `packages/` fails this slice.

**The plan parse is not a suspect.** `parse_plan_estate` (`plot-fleet-scan.sh:2851`) passes every plan to `plot-plan-meta.sh` in one invocation, measured at 481 ms for 350 plans. The rejected plan `a-parsed-plan-joins-the-index` proposed a parse cache against a 32 s cost that the panel measured as 481 ms. Report the parse as one row. Do not propose a cache.

**Neither load nor host latency explains it alone.** #1017 records load 52 → 12 with the timeout still present, and `backend` at 1 s and `pr-list` at 3-4 s. A table that blames one of these must show it with the four-part split, not argue it.

**`--offline` is not the board's shape.** The #1017 profile (about 125,000 builtin operations for 27 plans, no line above 12%) was `--offline`, on another commit. The board runs `--stream` with the host (`fleet.ts:3293`). Every run in the table is `--stream`.

**The thresholds are fixed.** 30% of the median wall for one cost, or a 45 s median. Do not adjust them to the result, and do not raise `FLEET_SCAN_BUDGET_MS`.

### Traps the measurement has

**The terminal cache decides how many host calls a run makes.** The board passes `PLOT_TERMINAL_CACHE` to every scan (`fleet.ts:3318`): `''` on the first pulse after a restart, then the map it collects from the previous run's stderr lines tagged `terminal:` (`fleet.ts:3322-3324`). With a warm map, a merged or deferred branch skips its host question; with `''`, every branch asks. "As the board sets it" therefore means: the first run with `PLOT_TERMINAL_CACHE=''`, each later run with the `terminal:` lines of the run before it (prefix stripped, one per line). Report the cold run in its own row, and compute the medians over the warm runs, because the warm run is the board's steady state. If you have a reason to read it differently, say so in the table rather than mixing the two.

**There are more host calls than the two `pr-list` lines.** The plan names `plot-fleet-scan.sh:882` and `:898`. On `origin/main` 2026-10-02 the scan also reaches `plot-host.sh`:

| Line | Call | When |
|---|---|---|
| 408-409 | `backend`, twice | only under `--loose` with fetch |
| 561 | `backend` | sets `HOST_LOOKUP_OK`, under fetch or `--next` |
| 882 | `pr-list --state open --rich` | every run with the host |
| 898 | `pr-list --state all` | every run with the host |
| 1167 | `pr-state <branch>` | per branch, unless `.list-complete` exists or the terminal cache answers |

Line 1167 is the one that scales with the branch count. Count its calls per run and sum them as one row.

**A `PS4` trace slows the shell it measures.** `PS4='+${EPOCHREALTIME} ${LINENO} '` with `bash -x` gives per-line timestamps, and the gap across a line that calls `plot-host.sh` or `git` is that child's wall time. The trace also inflates the shell share. Take wall and CPU from untraced runs (bash `time`, which counts waited children). Take the shares from traced runs, and report the traced wall beside the untraced wall, so a reader can see the inflation.

**Run the scan from a real checkout, not a copy.** The scan finds its helpers through `BASH_SOURCE`. A copy under `/tmp` resolves no helpers, and its footer reads all zeros.

**The board reads stderr.** A trace on stderr mixes with the `terminal:` lines. Separate them by the prefix, or send the trace to its own descriptor (`BASH_XTRACEFD`).

**Load is part of the result.** Record `uptime` before and after each run. A run at load 28 and a quiet run are different measurements. Name the load next to every wall time, and do not average runs at very different loads without saying so.

**Read-only against the host.** The scan only reads. Do not change the board's PR store or the scan's cache directories between runs, or the runs stop being comparable.

### Done when

The plan's `## Done when` slice-1 item is the specification: a table on #1017 gives, for at least three board-shaped runs on a named `origin/main` commit, the wall time, the CPU time, the load average, and the host, git, shell and wait parts, with the largest single cost named.

Assertions a naive measurement passes without:

- **One commit for every run.** A table that mixes commits measures two scripts.
- **The cache state per run** (cold or warm). Without it a host share cannot be compared between runs.
- **The four parts add up to the wall** within the trace's error, and the table shows the remainder. Missing seconds mean a call site is missing.
- **The verdict line:** which of the two thresholds holds, or "neither". Wave 2 is dispatched or deferred on that line.

Plus: the PR passes CI. The diff has no shipped code, so it needs no changeset.

### Bookkeeping

- Push the first commit (the Notes entry, even as a draft) as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while the runs are in progress). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to this slice's heading in the plan's `## Slices`, in the form `(Branch: bug/the-scan-time-is-measured, PR: #<number>)`.
- Post the table on #1017 as a comment. **Do not close #1017** and do not write `deferred:` on wave 2. A person does both after reading the verdict.

### Scope guard

This branch owns one file: `docs/plans/2026-10-01-a-scan-says-where-its-time-goes.md`, its `## Notes` section and its own slice heading's PR annotation. Do not edit the `State:` line; `plot-state-gate.sh` refuses it.

In flight at dispatch, verified 2026-10-02: `origin/bug/the-merge-subject-is-one-rule` changes `skills/plot/scripts/plot-fleet-scan.sh` by 369 lines and is not merged. If it merges while you measure, `origin/main` moves under the table. Finish every run on the commit you named, and say in Notes whether that commit includes the merge-subject change.

If you find something the plan did not anticipate, such as a cost outside the four parts, report it in the table rather than fixing it here.
