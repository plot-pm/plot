# The parser reads an assignee wherever it is

> 115 plan files carry an `Assignee:` line. `plot-plan-meta.sh` reports 71. The field is read only under `## Approval`, so 44 plans that write it under `## Status` — the section both templates offer — are dropped without a word.

## Status

- **State:** Approved
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-09-24, in-session review after panel (round 1)
- **Started:** 2026-09-25, Jan Wloka, `bug/the-assignee-is-read-in-status-too`

## Changelog

- `plot-plan-meta.sh` reports a plan's `Assignee:` wherever the plan writes it, rather than only under `## Approval`. Measured 2026-09-24: 115 of 331 plans carry the line and the parser reports 71 — a third of them invisible to every consumer that asks.

Board impact: **yes.** The parser is the plan-format contract; anything reading `assignee` from it sees the same third missing.

## Motivation

**A field written correctly and read conditionally is worse than a field nobody writes**, because the estate looks emptier than it is and decisions get made on the gap.

That happened here. `the-board-shows-me-only-my-work` rejected reviving `Assignee:` partly on *"71 of 321, and abandoned"* — a number this bug produces. A panel recounted 115 and the word did not survive.

## Design

### What was measured, 2026-09-24

```
grep -l '^- \*\*Assignee:\*\* *\S' docs/plans/*.md   →  115 files
plot-plan-meta.sh, non-empty assignee                →   71 files
                                                        ───────────
                                                         44 dropped
```

`plot-plan-meta.sh:863` gates the field:

```awk
if (lower ~ /^[ \t]*[-*]?[ \t]*\**assignee[:*]/ && canon_assignee == "") canon_assignee …
```

reached only while `section == "approval"`. **Both plan templates offer `## Status` and neither offers `## Approval`**, so authors writing the field into the section the template gives them are the ones dropped.

### Why the gate exists, and what must survive

The section test is not arbitrary — a parser that matched `Assignee:` anywhere would read a mention inside prose or a fenced example as a value. **The estate has measured that class of error**: `plot-reconcile-scan.sh` anchors its branch matcher at the start of a list item for exactly this reason, and a plan citing another plan's field must not set it.

So the fix widens the sections, it does not remove the anchor: **the field is read in `## Status` and `## Approval`, as a list item, and nowhere else.**

### What this does NOT do

- **It does not write the field anywhere**, or add it to a template. Whether `Assignee:` should be revived is `the-board-shows-me-only-my-work`'s question, and this plan only makes the evidence for it true.
- **It does not resolve the spellings.** `eins78`, `jwloka` and `Jan Wloka` are two people written three ways; that survives this fix and is named in the sibling plan.
- **It does not change any other field's gating.** Only `assignee` is measured as dropped; a sweep of the rest is a separate reading.

### Done when

- A plan writing `Assignee:` under `## Status` parses with that value, and one writing it under `## Approval` still does.
- **The count reconciles**: the parser reports 115, matching the grep.
- **A mention inside prose or a fenced block still parses as no assignee** — the regression this must not cause, and the reason the gate exists.
- A contract test pins all three.

## Slices

### The assignee is read in Status too (Branch: bug/the-assignee-is-read-in-status-too, PR: #987)

- `bug/the-assignee-is-read-in-status-too` — widen the section gate to `## Status` and `## Approval`, keeping the list-item anchor; contract tests for both sections, for prose, and for a fenced example; assert the parsed count matches the grep across the whole estate

## Notes

- Found by a panel juror recounting a number in `the-board-shows-me-only-my-work` rather than by anyone reading the parser. **The sibling plan's argument rested on the bug's output**, which is the cost of a silent drop.
- Not a new class: the estate already knows a field must be anchored, and already knows a parser that disagrees with a grep is a defect — `plot-reconcile-scan.sh`'s section 9 exists to report exactly that kind of gap between what a file says and what a reader sees.
