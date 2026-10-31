# Testability juror: the-fleet-scan-re-reads-what

Position: amend

## Summary

The Motivation holds where I could check it, and slice 1 is a sound first cut. The plan has no Done-when section, so no slice has a checkable done-condition today. Slice 4 describes behaviour that already exists. The "behaviour identical" claim for slice 1 is provable by an output comparison, but only after two normalisations, and the comparison covers 12 of about 1240 walked plans. The plan must name the oracle and the CPU command per slice before approval.

## What I executed

- `plot-fleet-scan.sh --offline --json` twice in this worktree, with no host token, `GH_CONFIG_DIR` empty, and `PLOT_PR_LISTING` and `PLOT_TERMINAL_CACHE` unset, under `/usr/bin/time -p`. Load 7.83 before, 8.92 after. Run 1: user 12.96 s, sys 16.64 s (29.6 s CPU), 248.6 s wall. Run 2: user 12.67 s, sys 14.99 s (27.7 s CPU), 64.1 s wall. The CPU figure agrees with the plan's 29.9 s and is stable to within 7 %; the wall figure varies by a factor of 4 at the same load. CPU is the right unit, and the offline invocation reproduces the cost with no host.
- `cmp` of the two outputs: they differ. `jq -S` with every `changed_ago_seconds` field deleted: the two outputs are identical. So the scan's `--json` is deterministic over a fixed repository state except for one clock-derived field.
- `jq .summary`: the output reports 12 plans, 35 waves, 35 branches, `host: unasked`.
- `grep -c "scan failed: timed out after 90000ms" .plot/logs/fleetd.err` in the main checkout: 620 (the plan says 619; the log grew by one). The lines carry no timestamp, so the count has no time window and does not give a failure rate.
- `git ls-tree -r --name-only origin/main -- docs/plans | grep -c .md$`: 1241 markdown files. `docs/plans/active` holds 1 entry. Both agree with the plan.
- `git grep` of `State:` lines on `origin/main`: 577 Released, 17 Rejected, 9 Superseded, 14 Delivered, 2 Approved among the files that use that line format.

## What I only read

- The four cited sites match the plan's line numbers: `plot-fleet-scan.sh:2783` (`ref_mode_of`, `printf | awk` over `$PLAN_MODES`), `:2883-2884` (two `$(basename "$p")` per call), `:3716-3722` (the merge-subject loop), `:3762-3765` (`merge-base --is-ancestor` and two `cat-file -e`).
- `fleetOwnsScan` in `packages/domain/src/rules/scan-owner.ts:37`, with `OWNED_BRIDGE_MAX_AGE_MS = 180_000` at `:10`, called from `packages/board/src/server/fleet.ts:2815-2822`. It shipped in #1444 (`7414c6308`) and has 10 cases in `packages/domain/test/scan-owner.test.ts`.
- `plot-fleet-scan.sh:3510-3539` appends every terminal plan to `plans`; `:4305-4312` drops released, rejected and superseded plans, and delivered docs and infra plans, from the row loop "before a single git call is spent". The merge-subject loop at `:3714` iterates over all of `plans`, terminal ones included.
- Existing tests that hold the touched code: `test/reconcile/fleetsubject.test.mjs` (17 tests, the merge-subject loop and its ancestry readings), `fleetrefplans.test.mjs` (16, ref-mode plan reads including the absolute-symlink case), `fleetreadref.test.mjs` (6), `scan.test.mjs` (201), `fleet.test.mjs` (179). Corpus: `branch-state.corpus.test.ts`, `branch-state-waits.corpus.test.ts`, `eligible.corpus.test.ts` and `refs.corpus.test.ts` spawn `plot-fleet-scan.sh --json` against a pinned clone (`packages/domain/corpus/pin-clone.ts`).

## Rubric

### 1. Motivation

It holds. The 620 timeouts, the 90 s budget at `fleet-scan.ts:48`, the 1241 plan files and the 30 s CPU figure all reproduce. Two corrections: the timeout count has no time window, so the plan should state the rate from a timestamped source (or add one); and the 14:34 board scan is explained by the existing code, see question 3.

### 2. Approach

- Step 4 is already shipped. The board already reads the bridge and spawns no scan when `fleetOwnsScan` holds. It stops holding when the bridge is older than 180 s, which is what happens after two consecutive 90 s timeouts. So the board's scan during fleetd's scan is the fallback firing because fleetd keeps timing out, and it adds load that makes the next fleetd scan slower. Slices 1 to 3 remove the cause. The plan must drop slice 4, or restate it as a measured change to this existing rule.
- A cheap cut is missing. The merge-subject loop does basename, case, awk and ancestry work for every terminal plan, while the row loop drops released, rejected and superseded plans unread. If the subject answers for those plans feed nothing else, filtering the loop to the plans the row loop keeps removes most of the 15.6 s and most of the 297 ancestry pairs without any cache. I did not prove that nothing else consumes them (`SLICE_NAMES` and cross-plan `waits:` are candidates); the plan must answer this before slice 2 sizes the ancestry cache.
- Slice 1 lists "ancestry process starts", but parameter expansion cannot remove `git merge-base --is-ancestor`. Those 7.7 s belong to the step-2 cache or to the filter above. Slice 1 must say so, or its done-condition cannot be met.

### 3. Slices

The order is right: slice 1 is shell-only, reversible and independently reviewable. Slices 2 and 3 each need a full-versus-incremental oracle, and the plan puts the corpus test in slice 3 only. Slice 2's cache is also a second path that can disagree with a recompute, so the same comparison must ship in slice 2 (cache cold versus cache warm). Slice 5 is not a slice yet: "shrinks towards a launcher" has no end state. It needs either a line count target from `scripts/check-shell-lines.sh --per-file` or splitting into named slices.

### 4. What would break, and how we would know

- Slice 1: a basename via `${p##*/}` differs from `basename` for a path with a trailing slash; the symlink lookup differs for an absolute symlink. `fleetrefplans.test.mjs` "an absolute symlink in the index still resolves" and `fleetsubject.test.mjs` hold these. The estate-wide proof is the normalised output comparison below.
- Slice 2: a stale cache entry cannot be wrong by construction if the key is the object id, but a cache keyed on the wrong id (a path, or a branch name) is. A test must mutate a plan blob and assert a miss.
- Slice 3: a dirty set that misses an input (claim refs, sprint file, `.plot/state`, desks) gives an incremental answer that differs from a recompute. Only the full-versus-incremental corpus comparison catches this, over a sequence of states, not one.

### 5. Open Questions

- Inputs besides plans and refs: not answered here. The scan reads `PLOT_TERMINAL_CACHE` (`:1456`), `PLOT_PR_LISTING`, the remote refs batch and the clock (`changed_ago_seconds`). The clock alone proves that a dirty set over git objects cannot be the whole story: an unchanged repository still changes the output every beat.
- Cache location across restarts: cannot be answered from the code yet; the plan's own rule (prune, never invalidate) allows memory-only as a first cut.
- The board scan as steady state: answered above from the code. It is the stale-bridge fallback, not a steady state, while fleetd times out.
- Slices 1 and 2 versus slice 5: slice 1 pays back in its first beat and has no dependency on slice 5. Slice 2's shell half is throwaway if slice 5 follows; build the cache behind the `Refs` port so slice 5 reuses it.

### 6. Required amendments

1. Add a `## Done when` section with one command per slice:
   - Slice 1: on a pinned clone (`pin-clone.ts`), run `plot-fleet-scan.sh --offline --json` with no host token before and after; `jq -S 'walk(if type=="object" then del(.changed_ago_seconds) else . end)'` of both are byte-identical. Also add a debug dump of the merge-subject sections and pairs (`SUBJECT_PLAN_SECTIONS`, `_sp_pairs`, `_sp_answers`) and compare it before and after, because the `--json` output reports 12 plans and the loop walks about 1240. `/usr/bin/time -p` user+sys of the same invocation drops by at least 15 s from about 29 s, with the load reported. `fleetsubject.test.mjs`, `fleetrefplans.test.mjs` and `fleetreadref.test.mjs` pass.
   - Slice 2: a test that runs the scan twice with a warm cache and asserts the normalised output equals a cold run; a test that changes one plan blob and asserts that plan is re-parsed; a test that the cache holds no verdict field (for *Answers, never verdicts*). CPU of a warm run under a stated bound.
   - Slice 3: the corpus test comparing full recompute and incremental output over at least three successive states (no change, one plan changed, one ref moved), normalised for clock fields. CPU of a no-change beat under a stated bound.
   - Slice 5: the shell line count from `check-shell-lines.sh --per-file` for `plot-fleet-scan.sh`, from 5438 to a named number, and the existing corpus tier passing unchanged.
2. Drop slice 4, or replace it with a measured change to `fleetOwnsScan` (for example, the board defers while a fleetd scan is in progress) and say why the 180 s bound is wrong.
3. Answer whether the merge-subject loop needs terminal plans; if not, add that filter as its own slice before slice 2.
4. Move the "ancestry" item out of slice 1 into slice 2 or the filter slice.
5. State that every comparison normalises `changed_ago_seconds` and runs with no host token and no carried listing, so a host answer cannot vary between the two runs.
