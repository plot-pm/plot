# A release between two sprints books its plans

> Where no sprint names the version, the release finish books the plans the release merge's changesets name and the Delivered plans whose slice merges lie in the tag's range, and it closes no sprint.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** fleet-runs-safely-alone
- **Issue:** #3736
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-27, jwloka, plan-PR #3740 merged
- **Started:** 2026-11-27, Jan Wloka, `bug/a-release-no-sprint-names-books-its-changesets`

## Changelog

- A release that no sprint names books its plans: the finish takes the plans its changesets name and the Delivered plans whose slice PRs merged since the previous tag. An open sprint that names another version is named in the finish's notes and no longer refuses it.

<!-- Board impact: none. The Delivery tab's `unbooked` item reads the same scope function; no plan format, template or docs/plans layout changes. -->

## Motivation

The active sprint `plot-describes-itself` names `Release: 2.38.0` (`docs/sprints/2026-W47-plot-describes-itself.md:14`); the operator moved it from 2.37.0 to ship 2.37.0 without closing the sprint. Release PR #3719 (`release: 2.37.0`) merged at 07:52 UTC on 2026-11-27 as `a55df0f41`, which carries the tag `v2.37.0`. No sprint names 2.37.0, so `releaseFinish` refuses `release-scope-mismatch` (`packages/domain/src/workflows/release-finish.ts:146-153`) and books nothing.

A person booked the release by hand: 11 commits `plot: release <slug> (v2.37.0)` between 07:57 and 08:00 UTC, from `63a5b69a9` to `8843327f2`. The release merge removed 15 changesets. 12 of them carry a `plan:` line, and those name 10 distinct plans. 3 carry none.

The 11th plan, `a-held-board-shows-the-indexed-tickets`, is named by no changeset. Its one slice PR #3709 merged as `9cb3fa3fa` on 2026-11-24 and carried no changeset at all. `9cb3fa3fa` lies in `v2.36.1..v2.37.0`, and the plan's slice line names `→ #3709`. The current scope reads changesets and sprints only (`releaseScope`, `packages/domain/src/rules/release-scope.ts:105`), so the finish misses this plan even where a sprint names the version.

## Design

### Approach

- **The shipped scope stands alone.** In `releaseScope`, where no sprint names the version, the scope is `named`: the plans the removed changesets name. `releaseFinish` books those and closes no sprint. `release-scope-mismatch` is removed as a refusal; an open sprint that names another version is named in `notes` (`open sprint <slug> names <version>; left open`).
- **The tag's range adds the merged slices.** The scope also holds every Delivered plan with a slice whose `→ #N` PR, or whose merge subject naming the branch, has its merge commit in `<previous tag>..<tag>` on the first-parent line. The previous tag is the highest `v*` tag below the version. This is a local read with no host call, and a merge subject is positive evidence only, as the wave gate already treats it (`rules/merge-subject.ts`).
- **A re-run of an older finish still books nothing new.** The range bounds the scope to this tag's merges, so a finish for 2.36.1 names only plans whose merges lie in `v2.36.0..v2.36.1`. A plan already holding a `Released:` record is skipped, and a scope with nothing left answers `already-released`, as now.
- **One scope function, two callers.** `releaseUnbooked` (`rules/release-unbooked.ts`) reads the same scope, so the Delivery tab's `unbooked` item names the same plans the finish books.

### Open Questions

- [ ] `[question-range-reads-ancestry]` Reading which merge commits lie in a tag's range is an ancestry question. Recommendation: declare it `evidence` under `check-ancestry-decisions.sh`: a merge commit named by a slice's own PR cannot be rewritten by a squash, and a wrong answer books one plan that a person can reject.
- [ ] `[question-delivered-only]` A plan whose slice merged in the range and that reads Approved is not finished work. Recommendation: the range arm adds Delivered plans only; the changeset arm keeps its current note for a named plan in another phase.
- [ ] `[question-sprint-close]` Recommendation: the finish closes a sprint only where its `Release:` names the version, as now.

## Slices

### Shipped Scope

- `bug/a-release-no-sprint-names-books-its-changesets` — `releaseScope` answers the changeset scope where no sprint names the version, `releaseFinish` drops `release-scope-mismatch` and notes the open sprint <!-- builds: the sprint-free release scope --> <!-- tests: the 2.37.0 fixture — no sprint names 2.37.0 and an open sprint names 2.38.0 — books the 10 changeset-named plans, closes no sprint and notes plot-describes-itself; a fully booked re-run answers already-released -->

### Tag Range

- `bug/the-release-scope-reads-the-tag-range` — the scope adds Delivered plans whose slice merge commits lie in `<previous tag>..<tag>` <!-- waits: bug/a-release-no-sprint-names-books-its-changesets --> <!-- builds: the tag-range arm of releaseScope --> <!-- tests: a plan whose only slice PR (3709) merged in v2.36.1..v2.37.0 with no changeset is in the 2.37.0 scope; a plan whose merge lies before v2.36.1 is not; an Approved plan in the range is not booked -->

## Notes

Created on 2026-11-27 for the sprint fleet-runs-safely-alone.
