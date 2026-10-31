## Implementation brief — the-fleet-scan-re-reads-what (wave 1: Process starts)

- **Plan (canonical):** docs/plans/2026-10-31-the-fleet-scan-re-reads-what.md on main
- **Approved:** 2026-10-31, Jan Wloka, plan-PR #2979 merged
- **Branch:** `feature/the-scan-walk-starts-no-process-per-plan` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review through the `plot/review` channel, per repo convention

Waves 2 (`feature/a-fleetd-whose-scans-start-owns-the-scan`) and 3 (`feature/the-subject-walk-skips-settled-plans`) are independent of this branch's output format. Slice 3 must fit in the shell lines this slice frees.

### What to build

`plot-fleet-scan.sh` starts a process per plan on every beat. Measured 2026-10-31 at load about 8: one scan with the listing carried takes 56.7 s wall and 29.9 s CPU, and about 40 s of the wall time is four per-plan sites. Three of them belong to this slice:

| Site | Work | Calls | Time |
|---|---|---|---|
| `:3716-3722` merge-subject loop | `basename "$(readlink …)"` plus a `case` match over `$SUBJECT_ADDING` | 2476 + 1238 | 15.6 s |
| `:2883-2884` `ref_plan_file` | `$(basename "$p")` twice | 3095 | 9.3 s |
| `:2783` `ref_mode_of` | `printf \| awk` over the whole `ls-tree` output | 1238 | 5.5 s |

Replace the `basename` calls with parameter expansion (`${p##*/}`), and build one lookup table in a single pass over `PLAN_MODES`, the index links and `SUBJECT_ADDING`. Each per-plan read becomes a table lookup. Output stays byte-identical. The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

- **Process starts, not git reads, are the cost.** One `basename` costs about 70 ms at load 7; a parameter expansion costs about 0.2 ms. Do not batch the git calls differently or add a cache.
- **The ancestry calls at `:3762-3765` stay.** Their 7.7 s belongs to slice 3 and the second plan ("The plan walk moves into the domain"). Do not touch them.
- **No disk cache and no file under `.plot/state`.** An oid cache, dirty set and domain walk are the second plan's scope; the panel showed a shell-side cache would carry verdicts across beats.
- **Wall time measures load; CPU is stable.** Report CPU (user + sys from `/usr/bin/time -p`) with the load average, never wall time alone.
- **The subject walk is not filtered here.** Skipping settled plans is slice 3, after it proves which readers consume them. This slice walks every plan, as today.
- **Absent is not false.** A path missing from `PLAN_MODES` must still give an empty mode, as a failed per-path `ls-tree` did. A lookup miss is not a default.

### Done when

The plan's `## Done when` Slice 1 list is the specification:

- `plot-fleet-scan.sh --offline --json` before and after gives byte-identical output after `jq -S 'walk(if type=="object" then del(.changed_ago_seconds) else . end)'`, on one pinned clone (`packages/domain/corpus/pin-clone.ts`), no host token, no carried listing.
- A debug dump of `SUBJECT_PLAN_SECTIONS`, `_sp_pairs` and `_sp_answers` is identical before and after. This catches a table that returns the right mode but the wrong adding commit, which the `--json` comparison alone can miss.
- CPU of the same invocation drops by at least 15 s from about 29 s.
- `node --test test/reconcile/fleetsubject.test.mjs test/reconcile/fleetrefplans.test.mjs test/reconcile/fleetreadref.test.mjs` passes.
- `scripts/check-shell-lines.sh pr` and `scripts/check-ancestry-decisions.sh` pass.

Run `node <plot scripts>/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base. This slice must shrink the shell; joining statements with `;` or `&&`, or folding `fi`/`done` onto the previous line, does not count as a payment.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to this branch's line in the plan's `## Slices`. Add a changeset (description first, `bumps:` block last). Push the first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-fleet-scan.sh` and the tests under `test/reconcile/` that exercise it. Wave 2 owns `packages/domain/src/rules/scan-owner.ts`, `packages/fleet/src/shared/fleet-clock.ts` and `packages/board/src/server/fleet.ts`. Wave 3 owns the merge-subject filter in `plot-fleet-scan.sh` at `:3716-3722` after this slice lands. If you find something the plan did not anticipate, report it rather than improvising outside scope.
