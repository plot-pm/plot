---
"@plot-pm/board": patch
---

board: every action a row offers lives in its menu

Four actions, two homes, and no rule telling them apart. *Open failing run*
and the conflict dispatch rendered inline in the row; *Start work* and
*Approve* rendered in the `⋯` menu. The split followed the order the four
were built in, and nothing else.

Reported while a row showed a CI failure — *why is "Open failing run" not in
the `⋯` menu?* The honest answer was that nobody had decided.

The rule now: **the row says what IS, the menu says what you can DO.** Both
inline actions moved into the menu as items with their own conditions.
Navigation to a thing the row NAMES — its plan, its branch, its PR — stays
inline, because a `cmd`-click on a real link is worth more than a tidier
line. *Open failing run* names none of those; it addresses a run, which the
row reports on rather than is.

Two measured costs, both gone:

**The run was reachable only while the row was red.** The link rendered on
`stuck.state === 'ci-failing'`, so the route to a run existed exactly as long
as the failure did, and a reader wanting the last run of a green branch had
no control at all. Its condition is now *a run URL exists*. The label
followed the condition — a green row offering *Open failing run* would
promise a failure that is not there, so the item reads **Open last run** and
the row's own stuck cell keeps the word *failing* for when it is true.

**The menu opened on nothing.** It rendered on every row, dimmed, on a layout
argument: rendering nothing would leave the right edge ragged and moving as
the five-second pulse gave and took actions. A later wave answered that — the
cell has a fixed `1.25rem` track, so the column holds still whether or not a
button is in it. What remained was a control that lies, measured lying on two
of six WAITING ON YOU rows. A row with no items now renders no button. **A
refusal is not an absence**: a row whose act the server declines still shows
its button and names the reason on it.

**The stuck cue did not move.** It is state rather than an action — it points
at something being wrong, and a signal reachable only by opening a menu is
not a signal. It renders in the row beside the word and the evidence it
describes.

Found on the way, and fixed here because the move exposed it: the
close-on-outside-click listener closed the menu on **capture**, while the
container that was supposed to stop it did so on React's **bubble** phase. The
close always won, so React 19 — which delegates to the root — unmounted the
menu before any handler inside it ran. The run link's click followed its href
and never fired `onTaken`, leaving the cue animating at an answered request.
It now hit-tests the target against the menu's own box.

The rule is a gate rather than a comment: a structural test scans every
component reachable from the row body, skips the menu, and fails on any `<a>`
or `<button>` that is not one of the row's three named-thing links. Verified
by putting the removed link back and watching it fail.

<!--
bumps:
  skills:
-->

No skill version bumps: this is a board-side change only. Nothing under
`skills/` changed but the generated `board-server.mjs` artifact, which is
rebuilt output rather than authored skill content, and no skill documents what
a row's `⋯` menu holds — so no skill's behaviour changed.
