---
'@plot-pm/board': patch
---

The sprint filter offers active sprints only.

It used to union in every distinct `card.sprint`, so any sprint slug written on
any plan became an option. Measured hours after a sprint closed: three options,
all Closed, while the Agents tab header correctly read *No active sprint*. A
plan's `Sprint:` field is history and does not clear when its sprint ends.

Options now come from `board.sprints` alone — `collectSprints`' read of
`<sprintDir>/active/` — so the filter is empty when no sprint is active. The
story filter already worked this way.
