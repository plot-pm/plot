---
"@plot-pm/board": patch
---

board: plans of the same age are ordered by name in every remaining section

The tiebreak `the-order-holds-still` landed for NOT STARTED, applied to the
sections that share the defect — WAITING ON YOU among them.

**The finding is that the fix was not finished.** The flicker was found,
diagnosed, fixed and merged in `sortByWaiting`, and the identical line sat four
hundred lines away in the same file: `groupByPlan`'s
`Math.max(...rows.map((r) => r.ageMinutes ?? -1))`, ordering the plan groups of
the other five sections on a coarse key with no tiebreak behind it. Nobody had
watched *this* section reshuffle. A fix is not finished when the reported
instance stops.

The mechanism is the one already recorded: age is a coarse key, so pairs of
rows that share an age compare `0`, and `Array.prototype.sort` — stable since
ES2019 — faithfully preserves the order the groups arrived in. **The arrival
order is what is not stable:** it is rebuilt from a fresh scan every four
seconds, from a Map whose insertion order follows that scan. The plan NAME
breaks the tie because it is the only field here that cannot change between
pulses; an age moves by the minute and a row count moves as branches land, and
both are derived.

**Fixed in `groupByPlan` rather than scoped to the reported section.** It has
one call site feeding all six sections, and only NOT STARTED re-sorts its
output; a tiebreak scoped to WAITING ON YOU would have left the identical
flicker in WORKING, WAITING ON A MACHINE, QUIET and DONE.

Not shared with `sortByWaiting`, which keys on `waitingDays` to answer *which
plan has been ignored longest* for a section whose rows are not branches. This
one keys on the branch tip's clock to answer *which plan holds the most urgent
row*. Two questions, two keys; only the three-line tiebreak is common.

Age still decides first: a plan holding an older row stays above an
alphabetically earlier one, plans of unknown age still sort last as a group, and
the server's row order inside each group is untouched.

Verified against the pre-fix source: three of the six new tests fail with the
arrival order they were given, and the three asserting unchanged behaviour pass.
NOT STARTED's own 23 tests pass unchanged.
