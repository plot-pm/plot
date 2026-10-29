# Tickets follow the delivery loop

> The plan issue, the HIGH tickets and the sprint item update with no hand edit: a slice-progress line after each merge, a named HIGH ticket in the plan issue's comment, and Jira transitions at the same points.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:** #2905
- **Story:** the-fleet-delivers-a-scope-alone
- **Review:** pr
- **Impl:** own branches

## Changelog

- After each slice merge, the plan issue's Plot comment shows a slice-progress line, for example "2 of 3 slices merged".
- The plan issue's Plot comment names each HIGH ticket the fleet opened and each answer the unblocker gave.
- Where Jira is the tracker, `plot-issue-status.sh` transitions the issue at the same points as the comment.

<!-- Board impact: none expected for the plan format, template or docs/plans layout. The plan-state comment is read by no board view today; confirm in slice 1 and rebuild the board artifact (pnpm build:board) only to test locally. -->

## Motivation

Issue #2905 is the "Tickets" part of [DESIGN-delivery-loop.md](../stories/the-fleet-delivers-a-scope-alone/DESIGN-delivery-loop.md), approved by jwloka on 2026-10-29. Goal 3 of that spec: ticket statuses follow the work without a hand edit.

Today the plan's issue changes at four points only: Draft (a link comment), Approved, Delivered and Released, written by `tracker-plan-state.ts` (`planStateComment` writes one line, `Plan <phase>: <link>`, into the comment marked `<!-- plot:plan-link -->`). Between Approved and Delivered the issue shows nothing, so a person reads the board or the PR list to learn that 2 of 3 slices merged. The HIGH follow-up ticket and every `PLOT-BLOCKED` answer are visible only in the places that wrote them.

## Design

### Approach

The spec's *After a merge* and *Tickets* sections bind this plan, including its Decided and Calls-made lists. Needs #2902 (the fleet merges slice PRs) and #2903 (a HIGH is fixed first, then ticketed): the progress line is written after the merge #2902 performs, and the HIGH line names the ticket #2903 opens.

1. **Progress line.** `planStateComment` takes an optional slice count (merged of total). The count comes from the plan's slice list and the host's merged answer (`plot-pr-merged.sh` reads `mergedAt`), never from ancestry. A new write point, after each slice merge, edits the same marked comment in place. The tracker port's `PlanStatePhase` gains no new phase; the progress is a field of the Approved-phase write, so no new `plan:*` label exists.
2. **Named tickets.** The same comment lists each HIGH ticket (number and link) and each unblocker answer (question, answer, who answered), as the spec's *A blocked agent* section requires. The comment is rebuilt from recorded state on every write, so one write order cannot lose another's line.
3. **Jira.** `issueStatusWrites` (`packages/domain/src/rules/issue-status.ts`) owes a write at `approved`, `delivered` and `released` today. The slice adds the transitions the spec names for "the same points", through the existing tracker connector and `plot-issue-status.sh`. It adds no shell logic: the script stays a launcher, under the `scripts/check-shell-lines.sh` ratchet.

No write reaches the tracker from a decision: each write reads the PR index and the plan (*A Decision Reads The Index*), and a failed write is reported and never raised, as `plot-issue-status.sh` already behaves.

### Open Questions

- [ ] **Which points does Jira transition at?** The spec says "the same three points" (Approved, Delivered, Released), which `plot-issue-status.sh` already covers. State what is new: a transition on the first merge (an `In Progress`-style word), on each progress step, or neither. Decide before slice 2.
- [ ] **Where does the unblocker answer record live until the unblocker exists?** The spec assigns the answers to the unblocker plan; this plan renders whatever record that plan writes. Confirm the record's shape with that plan's owner.
- [ ] **The sprint item.** The spec's table says the sprint item is ticked at delivery (today) and the sprint closed after the release. Confirm this plan adds nothing for the sprint item beyond the issue.
- [ ] **Comment size.** A plan with many slices, HIGH tickets and answers can pass a host's comment limit. Decide the cut: keep the last N answers and link the rest.

## Slices

### Progress

- `feature/the-plan-issue-shows-slice-progress` — after each slice merge, the plan issue's Plot comment shows "N of M slices merged" <!-- builds: the slice-progress line in planStateComment -->

### Tickets

- `feature/the-plan-issue-names-its-tickets` — the plan issue's Plot comment names each HIGH ticket and each unblocker answer <!-- builds: the ticket list in the plan-state comment -->

### Jira

- `feature/jira-follows-the-delivery-loop` — `plot-issue-status.sh` transitions a Jira issue at the same points as the comment <!-- builds: Jira transitions at the loop's write points -->

## Notes

- 2026-10-29: created from issue #2905 by `/plot-idea`, unattended. Stops at Draft; nothing was written to the tracker.
