# Layering juror: the-fleet-scan-re-reads-what

Position: amend

## Summary

Slice 1 is correct and urgent, and it touches only the shell. Slice 4 already exists in the code. Slices 2 and 3 name no layer, and the only layer that can hold an in-memory cache and a fresh verdict per beat is the TypeScript side that slice 5 creates. The plan must name the layer of each slice, drop or re-scope slice 4, and order the cache and the dirty set after the walk moves, or route them through the existing `PLOT_TERMINAL_CACHE` channel.

## What I executed and what I only read

Executed (read-only): `sed` over the four cited sites in `skills/plot/scripts/plot-fleet-scan.sh`; `grep -c` over `.plot/logs/fleetd.err` in the main checkout (620 timeout lines at 14:44, the plan says 619); `git ls-tree -r origin/main -- docs/plans | grep -c .md` (1241); timed `git for-each-ref` (0.19 s) and `git ls-tree` (0.19 s) at load 6-7.8; timed 500 `basename` calls (35.1 s wall) against 500 parameter expansions (0.11 s) at the same load; greps for `fleetOwnsScan`, `fleetHoldsBridge`, `PLOT_TERMINAL_CACHE`, the `Refs`, `PlanStore` and `Trees` ports, and the corpus directory.

Read only: `packages/domain/src/rules/scan-owner.ts`, `packages/board/src/server/fleet.ts:2735-2830`, `packages/fleet/src/shared/fleet-scan.ts:715-740`, `packages/fleet/src/shared/fleet-clock.ts:149-152`, the head of `scripts/check-shell-lines.sh`, and the `plan-store` port and adapters. I ran no test, no scan, no board and no fleet command.

## 1. Motivation

The motivation holds. The cited lines match: `ref_mode_of` at `:2783`, the double `basename` at `:2883-2884`, the merge-subject loop at `:3716-3722`, and the ancestry calls at `:3762-3765`. My own timing confirms the mechanism: one `basename` costs about 70 ms at load 7, and a parameter expansion costs about 0.2 ms. The change-detection reads are cheap (0.19 s each here, the plan says 63 ms and 7 ms; both are far below the budget).

The plan leaves one causal fact out. `fleet-clock.ts:149-152` writes the bridge only when a scan succeeds, and `fleetOwnsScan` (`scan-owner.ts:37-43`) hands the scan to the board when the bridge is older than `OWNED_BRIDGE_MAX_AGE_MS` (180 s). Two timed-out scans in a row therefore make the board start its own `plot-fleet-scan.sh --stream` (`packages/board/src/server/fleet.ts:2815-2823`). That explains the 14:34 observation, and it is a feedback loop: the timeout causes a second scan, the second scan adds load, and the load causes the next timeout. Open Question 3 has this answer, and the Motivation must say it.

## 2. Approach, through the layering lens

**Step 4 duplicates shipped code.** `fleetOwnsScan` (#1444, #1514, #1557) already makes a board beside a live fleetd read `last-pulse.json` and spawn nothing. The defect is not a missing rule; it is that the rule reads a timed-out fleet as absent. A board scan that starts because fleetd timed out is correct by the current rule. Amend step 4 to one of: (a) delete it, because slice 1 removes the timeouts that hand over the scan; or (b) re-scope it to the rule `fleetOwnsScan`, so that a live supervisor with a recent failed-scan heartbeat still owns the scan. Option (b) is a domain rule change with a unit test in `packages/domain`, not a board change.

**Steps 2 and 3 name no layer, and in the shell they cannot hold what the plan says.** The shell scan is a new process per beat (`fleet-scan.ts:717`), so a shell cache needs files on disk. That is new shell (the ratchet in `scripts/check-shell-lines.sh` makes it pay line for line) and a second writer under `.plot/state`. The repo has a precedent that respects the layering rule: fleetd holds `state.terminal` in memory and passes it as `PLOT_TERMINAL_CACHE` (`fleet-scan.ts:733`); the shell reports new entries on stderr as `terminal:` lines (`:738`). If step 2 ships before step 5, it must use that channel, and the cache then lives in fleetd's `ScanState`. That answers Open Question 2: in memory, and lost on restart, which is a cold full scan and correct.

**Step 3 conflicts with "Answers, never verdicts" unless step 5 lands first.** The shell emits a `FleetReading` whose rows already carry verdicts (eligibility, wave state, through `plot-verdicts.mjs`). A dirty set at the shell boundary would re-run the shell on dirty plans and keep the old rows for the rest. That persists verdicts across beats, which `fleet.ts:1423` and `supervision-report.ts:72` name as the refused shape. A verdict for an unchanged plan still depends on inputs outside the snapshot: the PR listing, desks (`git worktree list` appears five times in the scan, and a worker's marker files change no ref), the terminal cache, and `now` (`plot-fleet-scan.sh:2648`; `Claim stale after` and `Slice idle after` are time rules). The plan's sentence "verdicts stay derived fresh from the readings on every beat, by pure domain functions" is true only when the readings are held in TypeScript and the verdicts are computed there. That is step 5.

**The ancestry cache must not store `unknown`.** `:3769-3772` answers `unknown` when this checkout cannot read a commit, and a later fetch makes it readable. Only `yes` and `no` are immutable for a commit pair. This is the same rule as "only a terminal answer is read from the index". The plan says "never invalidation"; that holds only for terminal answers.

**The parsed-plan cache must key on the parser as well as the blob.** A blob sha does not change when `plot-plan-meta.sh` or the domain parser changes, so a cache that survives a fast-forward of `main` returns old parses. With an in-memory cache inside fleetd this is safe only while fleetd restarts on a bundle change; name the key as (blob sha, parser identity) or state that restart dependency.

**Step 5 names the wrong port.** The plan walk reads plan blobs and parses them. `PlanStore` already exists for that (`packages/domain/src/ports/plan-store.ts`, with `plan-store-ref.ts` reading at a ref, and `corpus/plan-store.corpus.test.ts` holding it to `plot-plan-meta.sh`). The walk is a domain workflow that reads `Refs` (refs and ancestry), `PlanStore` (plans at `origin/main`) and `Trees` (desks). "Behind the Refs port" puts a workflow inside an adapter. Also `Refs.listBranches` returns names only (`ports/refs.ts:193`); the snapshot needs ref-to-sha pairs, so step 3 or 5 adds one `Refs` operation and its `refs-git.ts` implementation.

**Step 5 has eight shell callers to keep.** Eight `SKILL.md` files call `plot-fleet-scan.sh` (plot, plot-dispatch, plot-deliver, plot-reconcile, plot-implement, plot-reslice, plot-pulse, ralph-plot-sprint). The script must become a launcher that `exec`s the new bundle, with the same `--stream` output contract, or the walk becomes an undeclared duplicate. During the transition the two walks are a declared duplicate and need a corpus test (`packages/domain/corpus/`) that compares their `FleetReading` per repository state, in the shape of `tracked-branches.corpus.test.ts`.

## 3. Slices

Slice 1 is the right first cut: it ships alone, it changes only the shell, it has a measurable done-condition, and it removes lines, which gives later slices ratchet room. Its done-condition must be written: the per-plan process count in the four loops is zero (a `PS4` trace or a shim count), the `--stream` output is byte-identical over a fixed repository state, and one loaded scan finishes under the 90 s budget.

Slices 2 and 3 have no checkable done-condition and no layer. Slice 4 is shipped code. Slice 5 has no done-condition. Proposed order: 1, then 5 (walk into the domain, shell becomes a launcher, corpus test holds the two walks), then 2 and 3 in TypeScript on top of it, and drop or re-scope 4 as above. If slice 2 must ship before 5, it rides `PLOT_TERMINAL_CACHE`'s channel and adds no disk cache.

## 4. What breaks and how we would know

- Slice 1: a parameter expansion differs from `basename` on a trailing slash or an empty path; a byte-diff of the scan's `--stream` output before and after over one pinned repository state shows it. `scripts/check-ancestry-decisions.sh` must still pass, because the ancestry call at `:3762` keeps its `plot-ancestry: evidence` declaration if it moves.
- Slice 2: a stale parse after a parser change, and a cached `unknown`; unit tests on the cache key and on refusing to store `unknown` show both.
- Slice 3: a verdict that ages (claim stale, slice idle) or a desk marker that appears without a ref move; the corpus test must include a state pair that differs only in time and only in a desk marker.
- Slice 5: a skill that calls the script and gets a different shape; the corpus comparison between shell and domain walks shows it before the shell walk is removed.

## 5. Open Questions

- Inputs besides plans and refs: the PR listing (`PLOT_PR_LISTING`), the terminal cache, desks and their markers (`git worktree list`, five sites), and `now`. Claim refs are refs and enter through `for-each-ref`. Desks and `now` cannot enter a ref snapshot; desks need their own reading per beat, and time-dependent verdicts must recompute every beat.
- Where the cache lives: in fleetd's `ScanState`, in memory, like `state.terminal`; a restart is a cold full scan.
- The board's own scan: not steady state by design. `fleetOwnsScan` hands the scan to the board only after the bridge is 180 s old, which two consecutive timeouts produce. 620 timeout lines make it frequent.
- Do slices 1 and 2 pay after slice 5: slice 1 pays, because it ends the timeouts now and frees ratchet lines. Slice 2 in shell is throwaway; ship it after slice 5 or through the existing env channel.

## 6. Amendments before approval

1. Add the feedback loop to the Motivation, with `fleet-clock.ts:149-152` and `scan-owner.ts:37-43`, and answer Open Question 3 from it.
2. Delete slice 4, or re-scope it to a change of `fleetOwnsScan` in `packages/domain/src/rules/scan-owner.ts` so that a live supervisor with failing scans keeps ownership.
3. Give each slice its layer: slice 1 shell; slices 2 and 3 fleetd (controller) plus a domain rule for the dirty-set diff plus one new `Refs` operation for ref-to-sha pairs in `refs-git.ts`; slice 5 a domain workflow over `Refs`, `PlanStore` and `Trees`.
4. Reorder to 1, 5, 2, 3, or state that slice 2 before 5 uses the `PLOT_TERMINAL_CACHE` channel and writes no disk cache.
5. State that the ancestry cache stores only `yes` and `no`, and that the parse cache keys on parser identity as well as blob sha.
6. Add to slice 5: the script becomes a launcher with the same `--stream` contract for its eight skill callers, and a corpus test declares the two walks as a duplicate until the shell walk is gone.
7. Add a written done-condition to every slice, with the command that proves it.
