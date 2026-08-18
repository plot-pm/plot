# Sprint: The board tells the truth

> Close the gap between what the board shows and what is actually true, so an operator running five agents can trust a glance.

## Status

- **Phase:** Active
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

- [ ] [not-yet-asked-is-not-nothing] The board distinguishes "not checked yet" from "nothing pending" — PRs #220 (merged), #221 (in review)
- [ ] [finished-is-not-a-verdict] A worker that stopped is not one that finished — PRs #218, #219 (both merged)
- [ ] [a-stale-ref-outranks-the-host] An unpruned tracking ref stops disabling the host lookup — PR #222 (merged)
- [ ] [one-place-for-what-a-row-can-do] Every row action lives in its menu — PR #224 (in review)

### Should Have

- [ ] [the-board-never-shrinks-on-a-success] Deliver — both waves merged (#211, #217)
- [ ] [the-board-answers-agents] Deliver wave 1 (#212), decide whether wave 2 belongs in this timebox
- [ ] [plot-board-setup] Deliver — waves merged as #208, #209
- [ ] Set the 32 delivered-but-unreleased plans to Released — measured by `plot-reconcile-scan.sh`, unreleased_delivered=32

### Could Have

- [ ] [the-repair-exists-but-nothing-calls-it] The pulse repairs an artifact conflict without being asked
- [ ] [the-pulse-measures-progress-not-elapsed-time] `changed_ago_seconds`, so a long job and a stuck one stop looking the same
- [ ] Decide PR #57 — conflicts resolved, `test:board` still failing after 23 days open

### Deferred

<!-- Items moved here during the sprint when they will not make the timebox -->

- [ ] [the-index-is-derived] Draft, three waves — too large for four days and not blocking anything
- [ ] A release window: dispatch refuses while a release PR is open (drafted, not yet committed)

## Retrospective

<!-- Filled during /plot-sprint close. The question this sprint exists to
     answer, beyond its items: did having a timebox change any decision that
     the plans and the board did not already drive? -->

## Notes

Created 2026-08-18 as the first real use of `/plot-sprint`, six months after
the skill shipped. The measurement that prompted it: 0 of 53 plans carry a
`Sprint:` field, while 40 of 53 carry a `Story:` field — thematic grouping had
taken hold and temporal grouping had not.

The items are the work that was already in flight, not work invented for the
sprint. That is deliberate: a first sprint that also changes what gets done
would confound the two things being tested.
