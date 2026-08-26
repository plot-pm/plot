# Sprint: The board tells the truth

> Close the gap between what the board shows and what is actually true, so an operator running five agents can trust a glance.

## Status

- **Phase:** Closed
- **Start:** 2026-08-18
- **End:** 2026-08-22
- **Release:** 2.6.0

## Sprint Goal

Five bugs found in one afternoon shared one shape: **a measurement that was
never taken, displayed as one that was.** A stale ref outranking the host, a
`none` printed before the first fetch, a timer tick silently dropped, an exited
worker filed as finished, ports listed after they closed.

The repo already carries the rule — `an-outage-is-not-an-answer`, delivered
2026-08-17 — as prose. This sprint is about whether stating it once was enough,
and about finishing the fixes that came out of finding it was not.

It is also the first sprint this repo has ever run. Plot has had sprint support
since February and nobody used it; whether it earns its place is part of what
this timebox is measuring.

### Must Have

- [x] [not-yet-asked-is-not-nothing] The board distinguishes "not checked yet" from "nothing pending" — PRs #220 (merged), #221 (in review) <!-- released v2.5.2; ticked 2026-08-26 on the plan's own phase, not on a re-reading of the work -->
- [x] [finished-is-not-a-verdict] A worker that stopped is not one that finished — PRs #218, #219 (both merged) <!-- released v2.5.2; ticked 2026-08-26 on the plan's own phase, not on a re-reading of the work -->
- [x] [a-stale-ref-outranks-the-host] An unpruned tracking ref stops disabling the host lookup — PR #222 (merged) <!-- released v2.5.2; ticked 2026-08-26 on the plan's own phase, not on a re-reading of the work -->
- [x] [one-place-for-what-a-row-can-do] Every row action lives in its menu — PR #224 (in review) <!-- released v2.5.2; ticked 2026-08-26 on the plan's own phase, not on a re-reading of the work -->

### Should Have

- [x] [the-board-never-shrinks-on-a-success] Deliver — both waves merged (#211, #217) <!-- released v2.5.1; ticked 2026-08-26 on the plan's own phase, not on a re-reading of the work -->
- [x] [the-board-answers-agents] Deliver wave 1 (#212), decide whether wave 2 belongs in this timebox <!-- released v2.7.0; ticked 2026-08-26 on the plan's own phase, not on a re-reading of the work -->
- [x] [plot-board-setup] Deliver — waves merged as #208, #209 <!-- released v2.7.0; ticked 2026-08-26 on the plan's own phase, not on a re-reading of the work -->
- [x] Set the 32 delivered-but-unreleased plans to Released — measured by `plot-reconcile-scan.sh`, unreleased_delivered=32 <!-- done: 2026-08-23, the sweep now reports unreleased_delivered=2 -->

### Could Have

- [x] [the-repair-exists-but-nothing-calls-it] The pulse repairs an artifact conflict without being asked <!-- released v2.7.0; ticked 2026-08-26 on the plan's own phase, not on a re-reading of the work -->
- [x] [the-pulse-measures-progress-not-elapsed-time] `changed_ago_seconds`, so a long job and a stuck one stop looking the same <!-- released v2.7.0; ticked 2026-08-26 on the plan's own phase, not on a re-reading of the work -->
- [x] Decide PR #57 — conflicts resolved, `test:board` still failing after 23 days open <!-- moved: 2026-08-23 to 2026-W35; DECIDED 2026-08-25 — closed unmerged at 31 days after measuring each change against main per file. Four of six had reached main by other routes; the remaining four documents were recovered on a fresh branch as #423, and the ralph budget machinery rebuilt against current main as #425 rather than rebased off a 1738-commit-behind branch. -->

### Deferred

<!-- Items moved here during the sprint when they will not make the timebox -->

- [x] [the-index-is-derived] Draft, three waves — too large for four days and not blocking anything <!-- released v2.7.0; ticked 2026-08-26 on the plan's own phase, not on a re-reading of the work -->
- [ ] A release window: dispatch refuses while a release PR is open (drafted, not yet committed)

## Retrospective

<!-- Filled during /plot-sprint close. The question this sprint exists to
     answer, beyond its items: did having a timebox change any decision that
     the plans and the board did not already drive? -->

## Notes

### Reconciled 2026-08-26

Closed 2026-08-22 reporting **1 of 13 done**. Ten of the twelve remaining items
were plans that reached `Phase: Released` afterwards, and nobody re-ticked the
boxes — so the file understated what the timebox achieved by an order of
magnitude.

Ticked on each plan's OWN phase, read from `plot-plan-meta.sh`, never on a
re-reading of the work. PR #57 was decided 2026-08-25 (closed unmerged, its
content recovered as #423 and #425) and is ticked with that record.

**One item is genuinely unbuilt**: *a release window — dispatch refuses while a
release PR is open*. It was never planned, and the sprint said so at the time
("drafted, not yet committed").

The asymmetry that caused this is now itself a plan: `/plot-sprint close`
refuses a CHECKED box over an undelivered plan — a false completion — and
nothing guards the inverse, an unchecked box over a released one.


Created 2026-08-18 as the first real use of `/plot-sprint`, six months after
the skill shipped. The measurement that prompted it: 0 of 53 plans carry a
`Sprint:` field, while 40 of 53 carry a `Story:` field — thematic grouping had
taken hold and temporal grouping had not.

The items are the work that was already in flight, not work invented for the
sprint. That is deliberate: a first sprint that also changes what gets done
would confound the two things being tested.

### Scope Changes

- **2026-08-23 — closed, two versions after its release shipped.** The sprint
  declared `Release: 2.6.0`, which shipped on 2026-08-15, and stayed Active
  through 2.7.0 and 2.8.0's timebox. It gated nothing in that window — the gate
  only fires on the release a sprint targets — but a sprint outliving its release
  is drift, and it hid the fact that one of its items was still genuinely open.

  Its two remaining items were checked rather than assumed:

  - **The 32 delivered-but-unreleased plans:** done. The sweep reports
    `unreleased_delivered=2` today, so 30 of the 32 were resolved — the item is
    closed on its own measurement rather than on the calendar.
  - **PR #57:** **not done, and worse than recorded.** Still open, still
    `mergeable_state: dirty`, last touched 2026-07-25 — **29 days**, not the 23
    the item states. It moves to `2026-W35`, because closing a sprint must not
    quietly absorb a decision nobody has taken.

## Notes (closing)

- 2026-08-23: closed. Every Must Have was delivered and released in 2.6.0; what
  kept the sprint Active was one Should Have that had since completed and one
  Could Have that had not. Recorded here rather than silently ticked, since the
  difference between those two is the whole reason to check before closing.
