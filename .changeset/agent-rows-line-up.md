---
"@plot-pm/board": minor
---

The agent row becomes a real grid, and the PR cell renders from fields rather
than from a sentence.

Four rows in WAITING ON YOU, and no two of them agreed on where anything sat.
Only three cells had a width — phase, age and the action menu — while plan and
branch were content-sized and `ml-auto` on the note shoved everything from there
to the right edge. So the slack collected *between* branch and PR, and the
branch started wherever the plan cell before it happened to end.

**Six fixed tracks: phase, plan, branch, PR, age, menu**, with the branch on
`1fr` because it is the longest and most variable value and the one worth
reading in full. **An empty cell now leaves a gap rather than shifting its
neighbours** — which is the whole point: a row with no phase aligns on branch
with one that has a phase, and a row whose plan name sits in the group heading
aligns with one whose does not. That second case is the one `showPlanHeading`
introduced an hour earlier, where two rows in the same section differed by a
whole cell.

**Overflow elides the MIDDLE, keeping both ends.** Branch names here share long
prefixes and differ at the tail — `feature/opus5-hardening-…` covers six
branches — so end-truncation renders all six identically, which reads as six
duplicate rows rather than as truncation. The head clips and the last twelve
characters are pinned, so the browser decides where the fold falls at whatever
width the column has; the full name stays in `title` and in the accessible name.

**Table semantics, without a `<table>`.** `role="grid"` on the list, `role="row"`
and `role="gridcell"` on the cells, and an `sr-only` header row carrying
`role="columnheader"`. The rows carry interactive controls and sit inside a
collapsible group structure with per-plan sub-headings, which table markup would
fight rather than serve. The phase's `sr-only` prefix goes with it: it existed
because *"column position conveys nothing and each row is heard as a run of
words"*, and that stops being true. It survives below `sm` and only there, where
a card has no columns for a header to name.

**The PR cell reads `{ number, url, draft, state }`** — the fields wave 1
delivered — instead of searching `row.note` for `PR #<n>`. That search was a
parser for a format nobody declared: it silently rendered an unlinked note the
moment the server's wording drifted, and could not produce a badge without
taking the sentence back apart. `draft` and `state` render as two badges, never
one folded into the other. The git host's own PR glyph replaces the word `PR`,
never the state — the number stays, the state stays as a word, and the glyph
carries an `aria-label`, since a bare `157` announces nothing. `unknown` renders
nothing at all: a word saying only *this board could not find out*, stamped on
every row of a host that carries no rollup, is noise.

**The note keeps everything a PR state cannot say** — *uncommitted work*,
*blocked by an earlier wave*, *claimed elsewhere*. It is relieved of one duty,
not replaced. The server still composes `PR #158, conflicts · awaiting review`,
so the row drops the leading PR clause when the fields already carry that same
number; a note it does not recognise is printed in full, which costs a duplicated
word rather than a lost link.

**Below 640px the row becomes a card**, because this is what the grid takes
away. The tab had zero responsive breakpoints and its only concession to a
narrow window was `flex-wrap` — which works precisely because *nothing depends
on the position*. A grid inverts that. Measured: the fixed tracks need 544px
before the branch gets a single pixel, and a 375px phone is 169px short. So each
row becomes a small block, branch on its own line with plan, phase, PR and age
wrapped beneath. **Nothing is dropped and nothing is elided** — dropping the
plan name was the cheaper answer and would re-open, at one width, the defect
`showPlanHeading` closed at every width.

The branch name carries an explicit `aria-label`, which the plan did not
anticipate. The fold renders as two flex items, and the accessible-name
algorithm joins adjacent boxes with a space: the row announced
`feat ure/reviewed`, a branch name no host would recognise and no reader could
search for. The fold is a fact about the column's width, so it belongs to the
visual channel alone.

<!--
bumps:
  skills: {}
-->
