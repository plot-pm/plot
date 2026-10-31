# Testability juror: the-plan-walk-moves-into-the

Position: amend

## Summary

The direction is right, and the repository already holds most of the oracle the plan needs. The plan does not use it. The "Done when" bullets in Notes are not a Done-when section: no bullet names a command, and no bullet belongs to slice 1. Slice 1 carries the whole walk, about 3400 of the scan's 5438 lines, and is not reviewable as one PR. The scan already hands its readings to four domain bundles on stdin, and those four seams give a natural four-way cut, each with a byte-comparable oracle. The cache's headline lever is the small one: a cold parse of every plan costs 0.52 s CPU of the scan's 28 to 30 s. The plan must make each slice report its own CPU, and the cache slice must justify itself against the CPU that slice 1 leaves.

## What I executed

All runs were in the panel worktree at load 8.9 to 9.2 (`uptime`), CPU from `/usr/bin/time -p` user + sys.

- `plot-plan-meta.sh docs/plans/*.md --prefixes '(idea|feature|bug|docs|infra)/'` over all 620 plan files: user 0.49 s, sys 0.03 s, 620 records. A full cold parse of the estate costs 0.52 s CPU.
- `git for-each-ref` (454 refs): under 0.01 s CPU. `git ls-tree -r origin/main -- docs/plans` (1244 entries, 623 of them mode 120000): under 0.01 s CPU. `git worktree list --porcelain` (33 worktrees in the main checkout): under 0.01 s CPU.
- `git ls-tree … | git cat-file --batch` over every plan blob on `origin/main`: 0.03 s CPU. One batched read of all plan text costs less than one `node` start.
- `node -e ''` with the given PATH: 0.01 s CPU, 0.13 s wall.
- `scripts/check-shell-lines.sh --per-file`: `plot-fleet-scan.sh` counts 2208 ratchet lines (the file holds 5438 lines). Existing launchers count 9 (`plot-approve.sh`) and hold 12 to 19 file lines.
- Counts by `grep`: the scan defines 51 functions and 19 headed sections; it calls 4 domain bundles; 31 files in `test/reconcile/` spawn it (1537 tests in those files, not all of them scan tests); 7 corpus test files spawn it, plus the helper `production.ts`, which is the eighth file the plan counts.

I did not run the scan itself; the #2979 testability verdict measured it at 27.7 and 29.6 s CPU and proved its `--json` byte-identical over a fixed state once `changed_ago_seconds` is removed. I ran no test suite.

## What I only read

- The four readings seams: `ask_merge_subject` pipes readings to `board/plot-merge-subject.mjs` (`plot-fleet-scan.sh:3680`); `ask_branch_states` to `board/plot-branch-state.mjs` (`:4171`); the row loop to `board/plot-verdicts.mjs` (`:4640`, and `outlook` at `:5095`); the delta to `board/plot-delta.mjs` (`:5242`, `:5428`). The verdict rules are already in the domain. What moves is the gathering of readings, not the deciding.
- The walk's extent: sections from *A slice that waits on another plan's branch* (`:1568`) through *The merge subjects* (`:3593`), `branch_readings` (`:3930`), and the row loop `for plan in "${plans[@]}"` (`:4275` to `:5093`), about 3400 lines and 40 of the 51 functions.
- Ports: `PlanStore` has `readPlans(files)` over working-tree paths only (`ports/plan-store.ts:136`); it has no read at a ref or a blob oid. `Refs` has `listBlobs(ref, dir)` (`:415`), `readBlobs(shas)` (`:432`), `branchTips` (`:443`), `mergeSubjects` (`:690`), `contains` (`:701`) and `pulse()` (`:400`). `Trees` has `list`, `presence`, `markers`, `quietSeconds` (`ports/trees.ts`). Parsing a blob read through `Refs.readBlobs` needs a `PlanStore` operation that parses text, or the walk writes temp files the way `ref_plan_file` (`:2837`) does today.
- The corpus pin (`corpus/pin-clone.ts:177-203`) clones `refs/remotes/origin/*` and checks out `HEAD` detached. It creates no desk, no worker process and no marker, so safety rows 14 to 18 (worktrees, status, worker, markers, mtimes) are never exercised by the pinned corpus. The #2979 verdict measured that the pinned `--json` reports 12 plans.
- `plot-fleetctl.sh:322` and `:337` recognise a scan by the token `plot-fleet-scan.sh` in a process's argv. A launcher that `exec`s `node …/plot-fleet-scan.mjs` changes that argv.
- `corpus/README.md` names two live-sample fields, `changed_ago_seconds` and `worker_activity`, compared by tolerance.

## Rubric

### 1. Motivation

It holds where I checked it. Change detection is as cheap as the plan says: the snapshot primitives each cost under 0.01 s CPU. One claim needs a correction: the Changelog sells "no plan parse" as the saving, but a full parse costs 0.52 s, under 2 % of the scan. The 28 to 30 s come from per-plan process starts and per-pair git calls (#2979: 15.6 s in the merge-subject loop, 7.7 s in ancestry). A walk in one `node` process with batched port reads (`readBlobs`, `branchTips`, `mergeSubjects`) removes most of those starts before any cache exists. The plan cites the #2979 input table "on branch `idea/the-fleet-scan-re-reads-what`"; the file is on `origin/main` now.

### 2. Approach

- Correct in shape: verdicts stay a function of all readings, the cache holds answers keyed by oid, and the 19 inputs split into oid-keyed and every-beat.
- Missing: an oracle finer than the output. A normalised `--json` equality over the pinned clone covers 12 reported plans and no desks. The readings lines the scan pipes into `plot-branch-state.mjs` and `plot-merge-subject.mjs` cover every walked plan and branch, and they are text, so a byte comparison over them proves the walk at the level where it can be wrong.
- Missing: the sandbox corpus. The 31 `test/reconcile/` files that spawn the scan already encode the shell walk's edge cases (absolute symlinks, double links, unread headings, spike readings, two-format plans, stale checkouts). The plan must run them against both walks while the duplicate lives, through one launcher switch (for example `PLOT_SCAN_WALK=shell|domain`), so each file is a fixture for both.
- Missing: Bitbucket. The scan mentions Bitbucket 17 times, and the merge subject has a second form on that host (`Merged in <branch> (pull request #N)`). The plan names no Bitbucket fixture. `merge-subject-bitbucket.corpus.test.ts` exists and is the model.
- Missing: a port operation. `PlanStore` cannot parse a blob from a ref. Slice 1 must name the operation it adds (parse text, or read at a ref) and its adapter test.
- Missing: process recognition. `plot-fleetctl.sh:322,337` matches `plot-fleet-scan.sh` in argv. The launcher slice must keep that token in the process's argv or change the recognition, with a `fleetctl.test.mjs` case for each.
- Step 4 (measure how often fleetd needs a fresh reading) has no slice and no done-condition.

### 3. Slices

The order walk, cache, launcher is right: the cache needs a walk to wrap, and the launcher needs a walk that is proved equal. Slice 1 is not reviewable. It covers about 3400 lines and 40 functions across 19 sections, three ports and eight caller modes. Cut it at the existing seams, each slice with its own oracle:

1. **Estate.** Enumeration from the ref, branch-only plans, the `active/` index, and the parse (`:2660` to `:3592`). Oracle: the set and records equal `readEstatePlanMeta` and `readSliceNames` in `corpus/production.ts`, which already read the shell's answer.
2. **Branch readings.** Remote refs, ancestry, merge subjects, `commits_landed`, conflicts, changed paths (`:1568` to `:1762`, `:1880` to `:2090`, `:2239` to `:2482`, `:3593` to `:4215`). Oracle: the stdin lines to `plot-merge-subject.mjs` and `plot-branch-state.mjs` byte-equal, on the pinned clone and in a Bitbucket sandbox.
3. **Desks.** Worktrees, worker, unpushed commits, `changed_ago` (`:1763` to `:1879`, `:2091` to `:2238`, `:2495` to `:2659`). Oracle: sandbox fixtures with a live desk, a dead worker, a lock and each marker, because the pinned clone has none. `changed_ago_seconds` and `worker_activity` compared by tolerance per `corpus/README.md`.
4. **Assembly.** The row loop and the output modes (`:4275` to `:5438`). Oracle: normalised `--json`, `--list-eligible`, `--slice-names`, `--next` and `<slug>` equal on the pinned clone, and the 31 `test/reconcile/` scan files green with the walk switch set to `domain`.

Then the cache slice and the launcher slice as written.

### 4. What would break, and how we would know

- A walk that reads a plan from the wrong ref or misses a branch-only plan: slice 1's set comparison against `readEstatePlanMeta`.
- A walk that reads a ref by name after the snapshot: the race test in Notes, which belongs to the cache slice.
- A cache keyed by a path or a branch name: a test that changes one blob under an unchanged path and asserts a re-parse.
- A cached `unknown` or a cached clock reading: a test that turns an unreadable commit readable (Notes lists it) and a test that advances `now` with no ref move and asserts `changed_ago_seconds` moves.
- A Bitbucket subject read as GitHub: the Bitbucket sandbox in slice 2.
- A launcher that `fleetctl` cannot see: `fleetctl.test.mjs` with the new argv.
- A CPU regression: each slice reports `/usr/bin/time -p` user + sys and load. A domain walk with per-call port spawns could cost more than the shell; slice 1 must show it does not.

Expected cost of a warm no-change beat, from my measurements: snapshot under 0.01 s, one `node` start 0.01 s, no parse, plus the every-beat reads (33 worktrees, worker state, markers, the listing). I estimate under 1 s CPU against 28 to 30 s today. The plan must state a bound and measure it, not take my estimate.

### 5. Open Questions

- **Which of the 19 inputs stay every beat.** Answerable now from the #2979 safety table: rows 2 to 10 move to an oid key (row 2 as the pair of main oid and branch oid, row 5 with the symlink target, row 7 with the config digest and parser version, row 9 the raw subject only); rows 1 and 11 to 18 stay every beat; row 19 is an output. The plan must copy the table into its Design, not point at a file.
- **Duplicate for one release or same sprint.** The walk switch needs both walks alive while the 31 sandbox files run against each, and the shell line ratchet charges nothing for keeping existing lines. Keep the shell walk as the declared duplicate until slice 4's comparisons are green in CI on `main`, then remove it in the launcher slice. A calendar bound adds nothing a green comparison does not.
- **Line count.** Existing launchers hold 12 to 19 file lines and 9 ratchet lines. The scan has more modes, but each passes through as arguments. Name the target as at most 25 ratchet lines from `check-shell-lines.sh --per-file`, from 2208, and use the ratchet's figure, not `wc -l`.
- **The eight corpus files.** The eighth is `production.ts`, a helper, so seven are tests. `branch-state`, `branch-state-waits`, `branch-state-waits-open-pr`, `eligible` and `refs` compare a domain rule or adapter with the scan's output. After the launcher, both sides are the domain, and each becomes a self-comparison: retire it, and move its fixtures to a unit test against the walk. `tracked-branches` and `scan-listing` hold a shell duplicate (`TRACKED_BRANCHES`, `prefill_pr_states`) that the walk removes: retire each in the slice that removes its shell half.

## Required amendments

1. Replace the Notes bullets with a `## Done when` section, one command per slice, each with `--offline`, no host token, no `PLOT_PR_LISTING` and no `PLOT_TERMINAL_CACHE`:
   - Estate: `pnpm --filter @plot-pm/domain run test:corpus -- plan-walk-estate` passes.
   - Branch readings: the same with `plan-walk-readings`, which byte-compares the bundle stdin on the pinned clone and in a Bitbucket sandbox.
   - Desks: `node --test test/reconcile/<named desk files>` with `PLOT_SCAN_WALK=domain` passes.
   - Assembly: `PLOT_SCAN_WALK=domain node --test test/reconcile/fleet*.test.mjs test/reconcile/scan*.test.mjs` passes, and the normalised `--json` corpus comparison passes.
   - Cache: the full-versus-incremental corpus test over the successive states Notes lists, plus the race test.
   - Launcher: `check-shell-lines.sh --per-file` reports at most 25 lines for `plot-fleet-scan.sh`, and `fleetctl.test.mjs` passes.
2. Cut slice 1 into the four slices above.
3. Give each slice a CPU line: `/usr/bin/time -p plot-fleet-scan.sh --offline --json` user + sys with load, on the pinned clone, against the 28 to 30 s baseline. Set a bound for a warm no-change beat (I propose 2 s at load up to 10) and a bound for a cold beat (no worse than the shell).
4. Correct the Changelog: the saving comes from removing process starts; the parse cache saves at most 0.52 s.
5. Name the `PlanStore` operation that parses a blob read at a ref.
6. Add a Bitbucket sandbox fixture to the branch-readings slice.
7. Give Approach step 4 a slice or remove it.
8. Copy the 19-input table into Design and answer the four Open Questions with the answers above or better ones.
