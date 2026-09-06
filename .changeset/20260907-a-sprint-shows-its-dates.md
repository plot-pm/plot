---
'plot': minor
---

A sprint card shows its timebox, and a sprint past its `End:` is visibly different from one still inside its box. `Start:` and `End:` were written by every sprint author and read by nothing — the fields were parsed onto `SprintCard` and stopped there, so the answer they exist to give was never shown.

`rules/timebox.ts` gives that answer: `upcoming`, `running`, `late`, or `none` where the file named no usable date. `late` is the word `transitions/sprint.ts` already uses — *"a sprint past its `plannedEnd` is late rather than closed, and nothing may close it on the calendar's word"* — so the rule reports, closes nothing, and writes no sprint file. It also says how late, because one day over and three weeks over are the same word and very different facts.

The rule takes today as a reading rather than reading a clock, and the two payloads stamp it once against one day. A row deciding its own timebox in the browser would compare each sprint against whenever that row rendered, so a board left open overnight would show its sprints crossing their end at different moments.

Both `SprintCardSchema` and `FleetSprintSchema` carry it, because the Agents-tab control that renders the sprint reads the fleet payload rather than the board's. The card picks a colour from the word and prints the server's wording; it compares no dates, which keeps the view state assertable without a browser.

A missing or malformed date is not a failure. The comparison is lexicographic and only sound for exactly `YYYY-MM-DD` — `2026-9-6` sorts after `2026-10-01` — so anything else reads as a date the file did not name. Measured across this estate's sprint files: all four states appear, including one naming only a start.

<!--
plan: docs/plans/2026-09-06-a-sprint-knows-when-it-ended.md
bumps:
  skills:
    plot: minor
-->
