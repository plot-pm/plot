# plot-record-pr writes the PR annotation on a prose line outside ## Slices

> `plot-record-pr.sh` appends `→ #N` to the first list line that starts with the backticked branch, wherever it sits, so a prose line under `## Design` can take the annotation and leave the slice line bare.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** ship-2-32-0
- **Issue:** #3225
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-07, Jan Wloka, plan-PR #3226 merged
- **Started:** 2026-11-07, Jan Wloka, `bug/plot-record-pr-writes-the-pr`

## Changelog

- `plot-record-pr` writes the `→ #N` annotation on the branch claim line inside `## Slices`, the line `branchClaims` reads, and leaves a prose line that names the branch elsewhere unchanged.

Board impact: `board/plot-record-pr.mjs` is a shipped bundle and rebuilds. The plan format does not change.

## Motivation

`annotateSlicePr` (`packages/domain/src/rules/slice-pr-annotation.ts`) matches the first line anywhere in the file that begins `` - `<branch>` ``. Its doc comment says it works "under `## Slices` or `## Branches`", but the code tests no section.

Measured 2026-11-07 on `docs/plans/2026-11-03-open-plot-review-findings-from-the.md`: the first such line is under `## Design` › `### Ordering` (line 102). Commit `978de4c77` ("plot: record PR #3169 for a-high-gets-its-own-fixer-attempts") put `→ #3169` there. The slice line under `## Slices` › `### Fixer attempts` (line 115) carries no reference. Two effects follow:

- `plot-deliver --release 2.31.0 open-plot-review-findings-from-the` refuses with "names no '→ #N' annotation on a slice that was not deferred", although PR #3169 merged on 2026-11-05.
- A re-run of the recorder refuses with "already carries a PR annotation … refusing to add a second", because the duplicate check reads the same prose line. The controller cannot repair its own record.

The line `branchClaims` reads and the line the recorder writes must be the same line. #3213 and #3222 aligned `branchClaims` with the slice lines; the recorder still has its own, wider match.

## Design

### Approach

`annotateSlicePr` selects the line the way `branchClaims` does: only inside the `## Slices` or `## Branches` section, and outside code fences.

- The bullet match stays anchored to the backticked branch. A matching line outside the section is never a candidate, for the write or for the duplicate check.
- The already-annotated refusal reads the selected line only. A `→ #N` on a prose line elsewhere does not refuse.
- A branch with no bullet inside the section answers `branch-unaddressed`, as it does today for a branch no bullet names.
- The section and fence rules come from one helper shared with `branchClaims` (`rules/cross-repo-reference.ts`), so the two cannot drift apart. A corpus test under `packages/domain/corpus/` runs both over `docs/plans/` and fails when a branch `branchClaims` reports has its annotation recorded on another line, per `docs/shell-and-domain.md`.
- The plan from 2026-11-03 joins the tests as a fixture: a prose line under `## Design` naming the branch before the slice line.
- The repair after the fix is operational: run `plot-record-pr.sh bug/a-high-gets-its-own-fixer-attempts 3169`, then book the plan with the 2.32.0 release (it belongs to sprint `card-alignment`). The stray `→ #3169` on line 102 stays in the file unless a person removes it; the recorder edits only the slice line.

### Settled Points

- A branch claimed on more than one line inside `## Slices` is a defect in the plan: one branch belongs to one slice. The recorder refuses such a plan, names every line that claims the branch, and writes nothing. It never takes the first line. Settled by jwloka, 2026-11-07.

## Slices

### Fix

- `bug/plot-record-pr-writes-the-pr` — restrict `annotateSlicePr` to the branch claim line inside `## Slices`, share the section and fence rules with `branchClaims`, add the corpus comparison and the 2026-11-03 fixture <!-- builds: a section-scoped annotateSlicePr, a corpus comparison between branchClaims and the recorder --> → #3230

## Notes

Source: tracker issue #3225. Created by `/plot-idea` unattended; the plan stops at Draft and nothing is written to the tracker. Review and Impl follow the repo's `Plan PRs: required` bound.
