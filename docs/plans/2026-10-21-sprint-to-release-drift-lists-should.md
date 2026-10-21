# Sprint-to-Release drift lists Should and Could items as not in the sprint

> The Release-to-sprint comparison builds the sprint's key set from Must Haves only, so a Release issue that a Should or Could item names is reported as missing from the sprint.

## Status

- **State:** Approved
- **Sprint:** bitbucket-jira-and-jenkins-work-with-the-board
- **Type:** bug
- **Issue:** #2279
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2286 merged

## Changelog

- The Release-to-sprint comparison counts the issue key of every sprint item in all three tiers, so a Release issue named by a Should or Could item no longer appears in `missingFromSprint`. The sprint-to-Release direction (`missingFromRelease`) stays Must Have only.

<!-- Board impact: none expected. The change is one domain rule and its gate entry point; the plan format and the sprint file layout are unchanged. Confirm during design that `plot-sprint-release.sh` already reports `should` and `could` with the same item shape as `must`, and that no board view renders `missingFromSprint`. -->

## Motivation

`plot-sprint-release-gate.sh kafka-gp-sync` on ewz-kus-portal lists 19 keys in `missingFromSprint`. Six of them are items in the sprint file: EWZKUS-3863, 3864 and 3867 under Should Have, and EWZKUS-3865, 3866 and 3868 under Could Have (found by the read-only ewz field test, round 6, on main `b33d3ee22`).

Cause, by reading the code:

- `sprintReleaseDrift` (`packages/domain/src/rules/sprint-release.ts:42-52`) takes one list, the Must Haves, and builds `namedKeys` from it. `missingFromSprint` is every Release key outside that set.
- `mustHavesFrom` (`packages/board/src/server/entry/sprint-release-gate.ts:136`) reads `block.must` only. `ReportedSprint` declares no `should` or `could`, although `plot-sprint-release.sh` emits both beside `must`.

Effect: `/plot-sprint` status prints "Jira kus-portal-102 carries 19 issue(s) this sprint does not list", which is false for 6 of the 19. `skills/plot/scripts/README.md:105` says "a Release issue no sprint item names", and the code contradicts that sentence.

Source: [#2279](https://github.com/plot-pm/plot/issues/2279). The delivered plan `sprint-release-comparison-drops-must-haves` (#2248) fixed key resolution for Must Haves and left the tier scope as it was.

## Design

### Approach

Split the two directions by tier:

- **Release to sprint (`missingFromSprint`):** the named-key set takes the resolved key of every sprint item in `must`, `should` and `could`.
- **Sprint to Release (`missingFromRelease`):** unchanged. Only Must Haves must appear in the Release. A Should or Could item absent from the Release is not drift.
- **`notCompared`:** unchanged, Must Haves with no key. Whether a keyless Should or Could item is listed there is an open question.

Likely shape: `sprintReleaseDrift` takes the Must Haves plus a second list of the other tiers' items, or one list of items carrying a `tier`. The gate entry reads `should` and `could` from the report and resolves each key with `resolveItemKey`, as it does for `must`. Update the TSDoc and the `README.md:105` row to state the tier scope of each direction.

Tests: a domain test with a Release key named only by a Should item and one named only by a Could item, expecting neither in `missingFromSprint`; a test that a Should item missing from the Release stays out of `missingFromRelease`; a gate-entry test over a report carrying all three tiers.

### Open Questions

- [ ] Does `plot-sprint-release.sh` give `should` and `could` items the `issues` and `ticket` fields that `mustHavesFrom` reads, or only `must`?
- [ ] Should a keyless Should or Could item appear in `notCompared`?
- [ ] Does any consumer other than `/plot-sprint` status read `missingFromSprint`?

## Slices

### Count all tiers

- `bug/sprint-to-release-drift-lists-should` — Count every sprint item's key in the Release-to-sprint direction and keep `missingFromRelease` Must Have only <!-- builds: a tier-complete named-key set in sprintReleaseDrift -->

## Notes

- Drafted from issue #2279 by `/plot-idea`. Stops at Draft: whether the fix is worth doing is the reader's decision.
