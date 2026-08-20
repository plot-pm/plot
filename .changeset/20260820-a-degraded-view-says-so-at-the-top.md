---
"@plot-pm/board": minor
---

board: a degraded view says so at the top

The board's failure notes were scattered — a dead server and a broken scan
stacked as two banners at the top, a shrink as a third, and the PR-failure note
sat at the FOOT of the Agents list, below every row it qualified. Two costs
followed: a reader scanning WAITING ON YOU and WAITING ON A MACHINE met the
incomplete rows before the sentence saying they were incomplete, and independent
failures read as unrelated notes rather than as one condition — with a third one
pushing the work down the page.

There are now two surfaces answering two questions. A `StatusPanel` at the TOP
answers *is something wrong?* — one fixed-size box carrying every status the
board has to report, most-severe-first (a dead server outranks a broken scan
outranks a shrink outranks a spent host), newest-first within a severity. It
names how many it holds (`2 of 3 statuses`) and pages through them, so a third
problem is one click away rather than off the bottom of the screen. A status that
arrives while the reader is watching flashes at the top for a few seconds and
then sorts into place — arrival is worth interrupting for, permanence is not; the
statuses already present when the panel first mounts are not treated as arrivals.
The panel disappears entirely when there is nothing to report, because an empty
status box is a claim the board is watching something and a healthy board is not.

The view-status line — `74 branches across 23 plans · scanned 4s ago · PR data
16s ago` — stays at the FOOT and is unchanged. It answers a different question,
*how fresh is what I see?*, and it is always true, which is exactly what
disqualifies it from a panel whose contract is to vanish.

The in-section `[data-issue-error]` note is untouched: it points at the exact
place the missing issue rows would have appeared, which a top panel cannot do.

Corrected mid-implementation from a first reading that proposed one banner per
condition in the `UnreachableOverlay` frame — that is one-per-condition wearing a
different coat, and two problems would still stack two frames.

Tests: the ordering is pinned as a pure function (severity, tie-break by
arrival, and the arrival flash); six browser assertions cover the panel end to
end — two conditions render one panel, it names its count, paging preserves the
order, a new status flashes then sorts in, the panel is absent when there is
nothing to report, and the footer line stays at the foot and unchanged.

<!--
bumps:
  skills:
-->
