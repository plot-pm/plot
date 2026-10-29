# A HIGH finding is fixed before its PR merges, then ticketed

> fleetd answers a HIGH review finding on a slice PR with a correction to the live desk or a fixer on a dead one, and opens a ticket only after two fixer attempts fail.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:** #2903
- **Story:** the-fleet-delivers-a-scope-alone
- **Review:** pr
- **Impl:** own branches

## Changelog

- A slice PR whose review on the current head holds a HIGH finding gets the findings as a correction when its desk is alive, and a fixer agent when its desk is dead, up to two fixer attempts per PR. When both attempts are spent, fleetd opens one ticket (`ai-generated`, assigned to the plan's author, linked from the PR), the reviewer writes `plot/review=success` on that head with the ticket named in the status description, and the PR merges. A red CI run on a PR whose desk is dead or out of corrections starts the same fixer under the same two attempts.

<!-- Board impact: none expected. The `plot/review` status description gains a ticket reference, which `plot-reconcile-scan.sh` and the board's review badge read as text today. Confirm once the description shape exists. -->

## Motivation

A HIGH finding waits for a master agent to start a fix agent. In the session of 2026-10-16 to 2026-10-29 the master agent started a fix agent for every HIGH finding and every red PR whose desk was dead or out of corrections ([DESIGN-delivery-loop.md](../stories/the-fleet-delivers-a-scope-alone/DESIGN-delivery-loop.md), *Intent*). When that session ends, the PR stays blocked on `plot/review=failure`.

Today `packages/board/src/server/entry/review.ts:494` writes `failure` for any HIGH count above zero, and `openFollowUp` opens a findings issue for every finding of any severity. Nothing reads a HIGH and starts a fix. The design settles the target (jwloka, 2026-10-29): a HIGH is fixed first, a ticket exists only for a HIGH the fleet could not fix, and an unfixed HIGH passes `plot/review` only through its ticket, with no bypass rights.

## Design

### Approach

The design's *The loop* table, *Tickets* table and *Decided* list bind this plan. This plan builds four arms of `rules/slice-pr-next.ts`, which #2900 introduces:

1. **HIGH on this head, desk alive** — the next step is a correction to the desk carrying the findings. No fixer starts, so one writer holds the branch.
2. **HIGH on this head, desk dead, attempts left** — the next step is to start the `fixer` role with the findings.
3. **HIGH on this head, attempts spent** — the next step is to open the ticket, then to have the reviewer write `plot/review=success` on this head with the ticket in the description, then to merge.
4. **CI red, desk dead or corrections spent** — the next step is to start the `fixer` (same two attempts).

**Attempts** are counted per PR, not per head, in a state file under `.plot/state/` that the rule reads. Two attempts per PR, matching the correction budget. The file shape is left to the builder. The rule reads it as a value (`## The Domain Package` in `CLAUDE.md`), and a missing or unreadable file reads as zero attempts spent.

**The ticket** is opened through the tracker connector, never by `gh`: label `ai-generated`, assignee the plan's author, a link from the PR, and a line in the plan issue's marked comment. The reviewer's `success` write reads the ticket's number from the ticket step, so a status description naming a ticket that does not exist cannot be written.

**What stays as it is:** the ruleset keeps requiring `plot/review`; the fleet gets no bypass rights; a clean review merges as before.

### Calls made here (check these)

- Rule and ports first, so the arms are unit-testable as values (`## The Domain Package`: *every rendered state is a domain property*). The merge, correction, fixer start and ticket write go through their existing controllers and ports.
- The attempts counter lives beside the PR index under `.plot/state/` and is written by one place, as `issues.json` is.

### Open Questions

- [ ] Does the `reviewer` write the `success` status itself after the ticket exists, or does fleetd write it through a controller? The design says "the reviewer then writes"; the review entry (`review.ts`) holds the only writer today.
- [ ] When the desk is alive but its corrections are spent, does a HIGH take the dead-desk arm? The design's table says "desk alive"; the CI-red row says "desk dead or corrections spent".
- [ ] Which tracker call opens the ticket where the repository declares `trackerNone` (the write answers `unaskable`)? The PR then merges with the HIGH unticketed, or holds.
- [ ] Two HIGH findings on one head: one ticket or one per finding? The design names "the HIGH ticket" in the singular.
- [ ] Prerequisites #2900 and #2902 name no plan yet, so their contracts (the rule's input type, the fixer role definition) are read from the design only.

## Slices

### Rule and attempts

- `feature/a-high-finding-is-fixed-before-rule` — the four arms in `rules/slice-pr-next.ts` and the per-PR attempts state file, with unit tests for each arm. <!-- builds: slice-pr-next HIGH and CI-red arms, a per-PR fixer attempts state file -->

### Ticket and review status

- `feature/a-high-finding-is-fixed-before-ticket` — open the `ai-generated` ticket after the attempts are spent, link it from the PR and the plan issue's comment, and write `plot/review=success` on the head with the ticket named. <!-- waits: feature/a-high-finding-is-fixed-before-rule --> <!-- builds: the HIGH ticket and its plot/review success description -->

## Notes

- Source: issue #2903 on plot-pm/plot. Needs #2900 and #2902. Section of the design: *The loop*.
- Out of scope here: MEDIUM and LOW findings (no ticket, a PR comment, per the design), the `fixer` role definition itself, and the red-main path.
