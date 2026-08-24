---
"@plot-pm/board": patch
---

fix(@plot-pm/board): the Agents tab filters on sprint membership

The Agents tab sprint filter now joins on the sprint file's membership list
rather than `row.sprint`. Previously the filter allowed ANY row with an empty
sprint field to pass, which admitted 53 plan rows (waves/branches) alongside
the 2 genuine plan-less rows.

- Added `slugPassesSprintFilter` function to filters.ts — the generalized
  predicate shared by all three tabs (Board, Swimlanes, Agents)
- Updated `sprintMembershipLookup` to accept both `SprintCard[]` and
  `FleetSprint[]`, since the Agents tab reads from fleet.sprints
- Changed the exemption from empty sprint string to row KIND: only `release`
  rows and unplanned `pr` rows (where `row.plan === ''`) pass without a
  membership check

<!--
bumps:
  skills: {}
-->
