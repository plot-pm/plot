# Sprint/Release comparison drops Must Haves whose Jira key is not on an Issue: line

> The sprint/Release comparison reads a sprint item's Jira key from one place only, so a Jira project that keeps keys in frontmatter or item text gets a wrong answer with no warning.

## Status

- **State:** Released
- **Type:** bug
- **Sprint:** bitbucket-jira-and-jenkins-work-with-the-board
- **Issue:** #2248
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2252 merged
- **Started:** 2026-10-21, Jan Wloka, `bug/sprint-release-comparison-drops-must-haves`
- **Delivered:** 2026-10-21
- **Released:** 2026-10-22, v2.28.0

## Changelog

- The sprint/Release comparison reads a sprint item's Jira key from the plan's `Issue:` line, then the plan's `ticket:` frontmatter, then the item text, and reports an item with no key as "not compared" by name.

<!-- Board impact: none expected. The comparison is a gate script and a domain rule; the plan format is unchanged. Confirm during design whether the board renders `sprintReleaseDrift` output. -->

## Motivation

`plot-sprint-release-gate.mjs` takes a key only from the plan's `issues` array (`firstJiraKey`). `plot-plan-meta.sh` fills `issues` only from a `- **Issue:**` line. `sprintReleaseDrift` (`packages/domain/src/rules/sprint-release.ts`) puts an item whose key is `''` in neither list, so the item vanishes without a word.

Measured 2026-10-21 on ewz-kus-portal (plot main `be96cdfe4`, read-only, `Tracker: jira https://quatico.atlassian.net`, `Sprint owner: plot`):

- 33 of 40 EWZKUS plans carry the key only in frontmatter (`ticket: EWZKUS-3845`) and the title. The delivered plan `ewzkus-3845-gpsync-abloesen` reports `issues: []`.
- The active sprint `kafka-gp-sync` (`Release: kus-portal-102`) has 7 Must Haves naming EWZKUS-3845, 3869, 3858, 3859, 3860, 3861 and 3862. Six name the key only in the item text, for example `- [ ] Tracer … (EWZKUS-3858)`.
- The gate reports `missingFromRelease: []` and lists all 26 Release issues as `missingFromSprint`. It matched 0 of 7 Must Haves and gives no reason.

This blocks release 2.28.0: release planning against a Jira Release gives a wrong answer on a real Jira project. Source: [#2248](https://github.com/plot-pm/plot/issues/2248).

## Design

### Approach

Resolve a sprint item's key in this order, first match wins:

1. the plan's `Issue:` line;
2. the plan's `ticket:` frontmatter;
3. a key in the item text that matches `Ticket prefixes`.

An item with no key found goes in a third list, `notCompared`, returned by `sprintReleaseDrift` and printed by the gate with the item's name. No item is dropped.

The key resolution is a decision, so it belongs in the domain (`rules/sprint-release.ts`) as a pure function over the plan reading and the item text. The gate script collects the readings and prints the result. The design must pass the MANIFESTO.md 9-question checklist.

### Open Questions

- [ ] Does `plot-plan-meta.sh` expose `ticket:` frontmatter today, or does the slice add a field?
- [ ] When the three sources name different keys, does the first win silently, or does the gate report the conflict?
- [ ] Does the board render `sprintReleaseDrift`, and does it need a "not compared" row?
- [ ] Does the shell/domain duplicate rule (`docs/shell-and-domain.md`) apply, and does the key resolution need a corpus test?

## Slices

### Key resolution

- `bug/sprint-release-comparison-drops-must-haves` — resolve a sprint item's key from `Issue:`, `ticket:` frontmatter and item text, and report an unkeyed item as not compared <!-- builds: resolveItemKey, a key resolver for sprint items --> → #2265

## Notes

Test fixture: the ewz-kus-portal measurement above (7 Must Haves, 26 Release issues, 0 matched today). Definition of Done: docs/definition-of-done.md.
