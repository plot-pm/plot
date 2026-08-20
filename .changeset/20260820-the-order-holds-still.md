---
"@plot-pm/board": patch
---

board: NOT STARTED plans of the same age are ordered by name

The section reordered on almost every 4 s pulse. A list of a dozen plans that
rearranges itself is unreadable: the eye re-finds its place from scratch each
time, and a row clicked at the moment of a pulse can be a different row than the
one aimed at.

**It was not a sorting bug.** `sortByWaiting` compares waiting days, which is a
coarse key — most plans in this section were approved on the same day, so most
comparisons return `0`. `Array.prototype.sort` has been stable since ES2019, so
it faithfully preserved the order the groups arrived in. **The arrival order is
what is not stable:** it is rebuilt from a fresh scan every pulse, from a Map
whose insertion order follows that scan. Stability preserved an unstable input.

The plan NAME breaks the tie, because it is the only field here that cannot
change between pulses — `planWaitingDays` moves at midnight, row counts move as
branches land, and both are derived. A name is the plan's identity.

Age still decides first: a plan that has waited longer stays above an
alphabetically earlier one, and undated plans still sort last as a group, now
ordered by name among themselves.

Verified by mutation: with the tiebreak replaced by `return 0`, two of the three
new tests fail with the arrival order they were given.
