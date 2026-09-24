# A released plan tells its tracker

> A plan names the issue it answers, ships, and reaches `Released` — and the issue stays open. The write exists in both tracker connectors and `plot-host.sh`; no lifecycle step calls it. Measured: 22 released plans name an issue, and one of them left its ticket open.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #935

## Changelog

- Delivering or releasing a plan records the outcome on the tracker issue the plan names, through the tracker connector that already implements the write. Measured 2026-09-24: `a-gate-matches-an-invocation` released in 2.19.0 naming `Issue: #935`, and #935 is still open five days later — found by a sprint sweep rather than by anything in Plot.

Board impact: **yes.** The board's inbox already removes an issue once a plan names it; an issue whose plan shipped is a different state and the board is where a person would see it.

## Motivation

**This is the estate's recurring shape, and CLAUDE.md names it**: *"where a rule exists and nothing calls it, that is a defect to report."*

Every piece is built:

| Piece | State |
|---|---|
| `plot-host.sh issue-status` | implemented — *"THE ONE WRITE TO A TRACKER"* |
| `statusWrite` on the GitHub connector | implemented (`tracker-github.ts:72`) |
| `statusWrite` on the Jira connector | implemented, calls the host (`tracker-jira.ts:86`) |
| A plan's `Issue:` field | parsed as `issues[]`, carried by **23 plans** |
| A lifecycle step that calls any of it | **none** |

`deliver.ts` and `release.ts` mention the tracker **zero times**. So the chain is complete from the domain outward and has no beginning: nothing ever asks.

## Design

### What was measured, 2026-09-24

```
plans naming an issue            23   (of 322)
  of those, released             22
  whose issue is still open       1   → #935
open tickets                      7
```

**The gap is one ticket, and the plan says so rather than inflating it.** A single miss is not a crisis; it is evidence that the path does not exist, which is the finding. The other 21 are closed because a person closed them — by hand, silently, and only when they happened to look.

**The failure mode is not the count, it is who notices.** #935 was found by a sprint sweep cross-checking tickets against plans, five days after the work shipped. Nothing in Plot reported it, and nothing would have.

### Where this belongs

The layering rule decides it and there is no latitude:

- **The decision is the domain's.** *Should this issue's status change, and to what?* is a rule over a plan's phase and its `issues[]` — pure, unit-testable, no I/O.
- **The write is the connector's.** `statusWrite` exists on both connectors and is reached through the tracker port. Nothing new is built there.
- **The caller is the lifecycle step.** `deliver` and `release` are where a phase changes, so they are where the question is asked.

### The shape of the fix

Add one call at the end of the transition that already succeeded:

1. the plan's phase reaches `Delivered` or `Released`
2. the plan names `issues[]` — **absent means nothing to do, and that is the common case**
3. the domain decides the status word
4. the tracker port writes it; the connector reports what happened

### Four refusals, each for a measured reason

- **A plan naming no issue does nothing.** 299 of 322 plans, so this is the default path and must cost nothing.
- **A repository with no tracker does nothing.** `trackerNone` answers `unaskable` on every operation *including the write* — a silent success there would claim a status reached a tracker somebody configured.
- **A failed write does not fail the delivery.** The plan is delivered; the tracker is a copy. A transition that rolls back because a remote service was down would make the tracker authoritative over Plot's own state, which inverts the relationship. **It reports and continues.**
- **The status word is the tracker's, not Plot's.** `statusWrite` already takes a configured status name, because *Done* is not a universal word. A hardcoded one is the defect this must not introduce.

### What this does NOT do

- **It does not close the issue.** `plot-host.sh` already draws this line: Plot *"creates no ticket, closes none, and touches no comment, label or assignee"*. A status is the one fact the tracker owns a copy of. **Closing stays a person's act** — and if that is wanted, it is a different plan with a different argument.
- **It does not backfill.** #935 wants closing by hand; this is about the next one.
- **It does not add a gate.** A delivery must not be refused because a tracker is unreachable.
- **It does not make `Issue:` required.** 299 plans carry none and are correct.

### Open Questions

- [ ] **Delivered, released, or both?** Delivered means the code merged; Released means it shipped to users. A tracker's *Done* probably means the second, but a team watching progress may want the first.
- [ ] **Is one miss enough to justify this?** Stated plainly because it is the honest question: the alternative is a `/plot-reconcile` section reporting released plans with open issues, which costs less and catches the same case a person then acts on. **A reporting section may be the better first slice.**

### Done when

- A plan naming an issue, reaching the configured phase, has that issue's status written through the tracker port.
- **A plan naming no issue, and a repository with no tracker, both do nothing** — and both are unit tests, because they are the common path.
- **A failed write reports and the delivery still succeeds.** The regression this must not cause.
- The status word comes from configuration, never from a literal in the rule.

## Slices

### The reconcile scan reports a released plan with an open issue (Branch: bug/the-scan-reports-an-open-issue)

- `bug/the-scan-reports-an-open-issue` — a read-only section naming every plan at `Delivered` or `Released` whose `issues[]` are still open on the tracker; gated on the host being reachable, reports and never writes. **First because it catches the case at a tenth of the cost**, and because it keeps working where the write is refused

### A finished plan writes its issue status (Branch: feature/a-finished-plan-writes-its-issue-status)

- `feature/a-finished-plan-writes-its-issue-status` — the domain rule deciding the status from a plan's phase and `issues[]`, called by the deliver and release workflows, written through the tracker port; unit tests for the no-issue, no-tracker and failed-write arms

## Notes

- Found by a sprint sweep on 2026-09-24 cross-checking every open ticket against the plan estate, not by anything in Plot. That is the finding restated: **the only detector was a person looking.**
- **The slice order is a hedge and says so.** The Open Question asks whether one miss justifies a write path at all. Slice 1 answers the same need read-only; if it proves the case is rare, slice 2 can be dropped without having built anything that writes to a remote service.
- The gate that guards this lifecycle fired on this plan's own research: a `grep` naming the deliver script in a search argument was refused as a controller-owned action. That is #935 — a Must Have in the same sprint — reproducing itself while a plan about its sibling was being written.
