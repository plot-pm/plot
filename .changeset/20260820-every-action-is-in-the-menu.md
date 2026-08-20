---
"@plot-pm/board": patch
---

board: the issue row's Create plan moves into the `⋯` menu, freeing the age column

Every row action on the board reaches the reader through the `⋯` menu — except
*Create plan* on an issue row, which `IssueRowView` rendered inline. Two costs,
both visible in one screenshot: the button sat in the `1.25rem` menu track, a
slot sized for a glyph, so its text overflowed left across the `2.5rem` age cell
and the issue rows read `1d`/`Create plan` overlapping; and the reader learned
two grammars, *actions are in the menu, except this one* — an artefact of the
`CreatePlanButton` predating the menu, not a decision.

`one-place-for-what-a-row-can-do` had already settled the rule and moved a
branch row's four actions behind `⋯`: **the row says what IS, the menu says what
you can DO.** This finishes the pattern on the row-kind that move did not touch.
A new `IssueRowActions` component renders the glyph that fits the track and
floats the action over the grid, so the age column beside it renders alone.

The button itself is unchanged — its two-step arm, its refusal on a host that
cannot be asked, its one-POST-per-click guard are all the button's, and moving
it changed only where it hangs. It keeps its `data-create-plan` hook, so the
browser tests reach the same control; they open the menu first, which is the one
behavioural difference. Escape now backs out of both the armed state and the
menu, since each listens for it and there is no reading in which one should be
left behind.

**The gate is a structural test, not the prose.** The existing
`a row's actions all live in its menu` scan starts at `Row` and never entered
`IssueRowView`, which is why *Create plan* survived on the issue row while every
branch action moved. The scan now has an issue-row arm: it walks `IssueRowView`
transitively, allows only `data-issue-link` (the tracker number, the one thing
the row NAMES) inline, and fails naming any other interactive element — verified
by injecting an inline action back and watching it catch. Without it the next
issue-row action lands beside the age again.

<!--
bumps:
  skills:
-->

No skill version bumps: this is a board-side change only. No helper script is
touched and no skill instruction changes — the move is entirely inside
`AgentList.tsx`. Manifesto Principle 3 keeps the interpretation on the board's
side.
