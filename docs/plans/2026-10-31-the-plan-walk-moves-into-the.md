# The plan walk moves into the domain

> A domain workflow walks the plans through the `PlanStore`, `Refs` and `Trees` ports and re-reads only what changed; `plot-fleet-scan.sh` shrinks to a launcher.

## Status

- **State:** Draft
- **Type:** feature
- **Issue:** #2980
- **Review:** pr
- **Impl:** own branches

## Changelog

- The fleet scan reads only the plans, branches and commits whose git object ids changed since the last beat. A beat on an unchanged repository costs a snapshot and no plan parse.

<!-- Board impact: none to the plan format or template. The scan's output contract stays unchanged for every caller mode, so the board reads the same pulse. -->

## Motivation

`skills/plot/scripts/plot-fleet-scan.sh` (5438 lines) re-derives every reading on every beat. A beat on an unchanged repository re-reads about 1240 plan entries and asks git about every branch.

Measured 2026-10-31:

- A scan costs 28 to 30 s CPU at load 8 to 10 (`/usr/bin/time -p`, user + sys).
- `origin/main` moved 50 times in 6 hours. fleetd scans about once a minute, so most beats see no change.
- `git for-each-ref` over the refs and `git ls-tree -r origin/main -- docs/plans` each cost under 0.2 s, so change detection is cheap.

Plan `the-fleet-scan-re-reads-what` (#2979, issue #2978) removes the per-plan process starts and the settled-plan walk inside the shell. This plan makes the long-term change: read only what changed, from a walk that lives in the domain.

The panel on #2979 listed 19 inputs the scan reads, each with its rule (oid key or every beat): `.plot/panels/the-fleet-scan-re-reads-what/safety.md`, section 2, on branch `idea/the-fleet-scan-re-reads-what`.

## Design

### Approach

1. **The plan walk moves into the domain.** A domain workflow reads through the `PlanStore`, `Refs` and `Trees` ports. `Refs.pulse()` stops spawning the scan. `plot-fleet-scan.sh` becomes a launcher that keeps its output contract for every caller mode: fleetd `--stream`, the board fallback, `Refs.pulse()` `--json`, `plot-dispatch.sh --slice-names` and `--list-eligible`, `--next`, `--log-pulse`, `<slug>`, and the process recognition in `plot-fleetctl.sh`. A corpus test declares the shell and domain walks a duplicate until the shell walk is removed. The eight corpus files that spawn the scan are each retired by name or kept by name.
2. **Answers cached by git object id, in fleetd's memory.**
   - A parsed plan is keyed by (blob oid, parser version, Plot Config digest).
   - An ancestry answer is keyed by its commit pair.
   - A merge commit's subject and files are keyed by its oid.
   - Every value is read through the oids in its key, never through a ref name.
   - `unknown` and failed reads are never cached.
   - Ancestry entries are refused on a shallow repository or when `refs/replace` is not empty.
   - The cache is not shared with the dispatch re-check.
3. **Re-read only what changed.** One snapshot per beat holds ref oids, plan tree oids and symlink targets. A reading whose key did not change is a cache hit. Desks, worktrees, worker processes, markers, `PLOT_PR_LISTING`, `PLOT_TERMINAL_CACHE`, the Plot Config, `now` and the fetch result are read every beat. The dirty set bounds reads only: verdicts stay a function of all readings on every beat, and every output carries every plan.
4. **Measure how often fleetd needs a fresh reading at all.** A cheaper scan and a rarer scan are separate levers, and the measurement decides whether the second is worth building.

Layering follows `CLAUDE.md`: controller → domain → port ← adapter. The workflow takes readings as values, and the adapters own every git and process call.

### Open Questions

- [ ] Which of the 19 inputs in the #2979 panel's section 2 stay "every beat", and which move to an oid key? The slice that writes the cache takes the panel's rule for each as given.
- [ ] Does the shell walk stay as the declared duplicate for one release, or does the launcher slice land in the same sprint as the domain walk?
- [ ] What line count does `plot-fleet-scan.sh` shrink to? The final slice names the number once the walk's remaining shell is measured.
- [ ] Which of the eight scan-spawning corpus files retire, and which stay?

## Slices

### Walk

- `feature/the-plan-walk-in-the-domain` — domain workflow that walks plans through `PlanStore`, `Refs` and `Trees`, with a corpus test holding it equal to the shell walk <!-- builds: planWalk, a domain workflow reading the plan estate through ports -->

### Cache

- `feature/the-walk-caches-by-oid` — oid-keyed caches for parsed plans, ancestry answers and merge subjects, plus the per-beat snapshot and dirty set <!-- waits: feature/the-plan-walk-in-the-domain --> <!-- builds: beat snapshot, an oid snapshot of refs, plan trees and symlink targets -->

### Launcher

- `feature/the-scan-script-is-a-launcher` — `Refs.pulse()` calls the domain; `plot-fleet-scan.sh` shrinks to a launcher with the output contract of every caller mode <!-- waits: feature/the-walk-caches-by-oid -->

## Notes

- Done when: a corpus test compares the full recompute with the incremental path over successive repository states — main moves while a branch stays, a ref is pruned, an `active/` link is retargeted, a `waits:` prerequisite merges, a listing row changes only CI or draft, an unreadable commit becomes readable, the branch prefixes change, the parser changes.
- Done when: a race test moves a ref between the snapshot and the reads and finds no cache entry whose key differs from the oid that was read.
- Done when: `plot-fleet-scan.sh` shrinks to a named line count.
- Source: issue #2980 (https://github.com/plot-pm/plot/issues/2980). Related plan: `the-fleet-scan-re-reads-what` (#2979), and `2026-10-26-the-fleet-scan-re-reads-all`.
- Definition of Done: docs/definition-of-done.md
