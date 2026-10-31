# The fleet scan re-reads what did not change

> fleetd's scan takes 57 s under load against a 90 s budget, and 40 s of that is four per-plan shell loops that start a process per plan on every beat, although the repository rarely changes between two beats.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:** #2978
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- The fleet scan reads only what changed since its last beat: it starts no process per plan, caches git answers by object id, and a board beside a live fleetd runs no scan of its own.

<!-- Board impact: slices 4 and 5 change who runs `plot-fleet-scan.sh` and what the board reads from `last-pulse.json`; slice 1 to 3 change no contract the board consumes. -->

## Motivation

`.plot/logs/fleetd.err` holds 619 lines `plot-fleetd: scan failed: timed out after 90000ms`. `FLEET_SCAN_BUDGET_MS` is 90 s (`packages/fleet/src/shared/fleet-scan.ts:48`).

Measured 2026-10-31:

- One scan with the PR listing carried, as fleetd runs it: 56.7 s wall, 29.9 s CPU (user 14.05 s, sys 15.82 s), load 8.5 to 10.1.
- One scan with no carried listing: 149 s wall, 34 s CPU. The PR listing took about 40 s of it.
- The estate holds 1242 plan files under `docs/plans` on `origin/main`, 1 active plan symlink and 66 branch refs.
- `origin/main` moved 50 times in 6 hours. The scan runs about once a minute, so most beats see no change.
- Change detection is cheap: `git for-each-ref` over the refs takes 63 ms and `git ls-tree -r origin/main -- docs/plans` takes 7 ms.
- A per-line trace (`PS4` with `EPOCHREALTIME`) puts about 40 of the 57 s in four per-plan loops in `skills/plot/scripts/plot-fleet-scan.sh`:

| Site | Work | Calls | Time |
|---|---|---|---|
| `:3716-3722` merge-subject loop | `basename "$(readlink …)"` and a `case` match over all of `$SUBJECT_ADDING`, per plan | 2476 + 1238 | 15.6 s |
| `:2883-2884` `ref_plan_file` | `$(basename "$p")` twice per plan | 3095 | 9.3 s |
| `:2783` `ref_mode_of` | `printf \| awk` over the whole `ls-tree` output, per plan | 1238 | 5.5 s |
| `:3762-3765` ancestry | `git merge-base --is-ancestor` and two `git cat-file -e`, per refless branch | 297 | 7.7 s |

By command: `basename` 11.0 s, `case` 10.6 s, `git` 9.9 s. At 14:34 the board (`plot-boardctl.sh` tree) ran its own `plot-fleet-scan.sh --stream` while fleetd's scan ran. Whether that is the steady state is not yet confirmed.

## Design

### Approach

Five steps, ordered by cost per risk. Each keeps behaviour identical until the corpus test below says otherwise.

1. **Remove per-plan process starts in the shell scan.** Parameter expansion replaces `basename`; one pass builds the symlink, mode and adding-commit lookups. Expected: about 25 s off a loaded scan.
2. **Cache facts keyed by git object id.** A parsed plan keyed by its blob sha, an ancestry answer keyed by its commit pair, a merge commit's subject and files keyed by its sha. Git re-derives these at any time and a ref move never makes them wrong, so the cache needs pruning and never invalidation.
3. **Read one snapshot per beat and compute a dirty set.** `for-each-ref` plus `ls-tree`, compared with the last snapshot. The scan re-reads changed plans, moved branches, branches a changed plan names, and changed PR-index rows. Verdicts stay derived fresh from the readings on every beat, by pure domain functions.
4. **One scanner per repository.** A board that sees a live fleetd heartbeat reads the bridge (`last-pulse.json`) and runs no scan.
5. **Retire the shell plan walk.** The walk moves into the domain behind the `Refs` port, and `plot-fleet-scan.sh` shrinks towards a launcher.

A cold start, or a missing cache, is a full scan. A corpus test compares the full recompute with the incremental path over the same repository states, and a disagreement stops the branch.

Constraints from `CLAUDE.md`: the cache holds answers and never verdicts (*Answers, never verdicts*); steps 2 to 5 follow the layering rule (controller → domain → port ← adapter); a new shell duplicate pays in lines (`scripts/check-shell-lines.sh`); the destructive "did this land" decisions keep reading the host (`plot-pr-merged.sh`), so the ancestry cache in step 2 serves only the non-destructive reads the scan already makes by ancestry.

### Open Questions

- [ ] Which inputs besides plans and refs does the scan read (claim refs, the sprint file, `.plot/state` files, desks), and how does each enter the dirty set?
- [ ] Where does the object-id cache live across a fleetd restart, if anywhere?
- [ ] Is the board's own `--stream` scan during fleetd's scan the steady state? Measure before slice 4 sizes its work.
- [ ] Do slices 1 and 2 still pay once slice 5 retires the shell walk, or does slice 5 make the shell fixes throwaway? Slice 1 ships first because it is the cheapest cut of the 90 s overrun.

## Slices

### Process starts

- `feature/the-scan-walk-starts-no-process-per-plan` — remove the per-plan `basename`, `case`, `awk` and ancestry process starts from the four loops in `plot-fleet-scan.sh`, behaviour identical <!-- builds: single-pass symlink, mode and adding-commit lookup in plot-fleet-scan.sh -->

### Object-id cache

- `feature/the-scan-caches-git-answers-by-object-id` — cache parsed plans, ancestry pairs and merge-commit subjects and files by git object id, with pruning and no invalidation <!-- builds: object-id keyed scan cache -->

### Dirty set

- `feature/the-scan-re-reads-only-the-dirty-set` — snapshot refs and plan tree per beat, diff against the last snapshot, re-read only the dirty set, and add the corpus test comparing full recompute with the incremental path <!-- builds: scan snapshot diff and dirty set -->

### One scanner

- `feature/one-scanner-per-repository` — a board beside a live fleetd heartbeat reads `last-pulse.json` and runs no scan

### Domain walk

- `feature/the-plan-walk-moves-into-the-domain` — move the plan walk behind the `Refs` port; `plot-fleet-scan.sh` shrinks towards a launcher

## Notes

- Raised from issue #2978 on 2026-10-31. The plan answers the issue's problem statement; the tracker is written nowhere.
