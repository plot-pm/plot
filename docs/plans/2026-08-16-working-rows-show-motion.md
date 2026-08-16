# A tab about live work that holds still and buries its own status

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:**
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:**
- **Started:**
- **Delivered:**

## Problem

The Agents tab exists to show work in flight, and it renders like a table of
records. A branch an agent is editing right now looks exactly like one nobody
has touched for 22 days — same weight, same stillness, different text. The
reader has to *read* to find out that anything is happening.

Measured: the board contains **no animation at all**. Not a transition, not a
pulse, no `prefers-reduced-motion` block — so there is also no existing
convention to follow, and whatever this plan does becomes the first one.

**And the quietest groups push the status line off the screen.** Seen on the
live board: `QUIET (7)` and `DONE (13)` together render twenty rows, six of
which have said *no commit for 22 days* for three weeks — and the footer that
reports when the last scan ran, and when the next one is due, has scrolled out
of view.

The two problems are the same question asked twice: **how does this view behave
when you leave it open beside your work?** One answer is that live rows should
look live. The other is that dormant rows should not cost the space the live
ones need.

The group order already encodes the intent — `waiting-on-you`, `working`,
`waiting-on-machine`, `not-started`, `quiet`, `done`, deliberately actionable
before diagnostic. What the ordering cannot do is stop a group at the bottom
from consuming full vertical space anyway.

Worth recording because it was a genuine worry and turned out fine: the same
screenshot showed the banner *"Last scan failed … showing the last successful
pulse below"*, which is [`board-tells-the-truth`](2026-08-16-board-tells-the-truth.md)
working exactly as designed. Re-running the scan by hand gave `exit=0` — it had
failed transiently while an agent was writing `plot-fleet-scan.sh`. Before that
plan landed, this would have appeared as silently stale data with a ticking
clock.

## Design

### The indicator belongs to the group, not to a guess

A moving indicator is a claim, and the honest version of that claim is narrow.
The board polls git every 5 seconds; it does not watch an agent. `WORKING` does
not mean *an agent is typing right now* — it means the branch met one of three
conditions at the last scan:

| Note | What it rests on |
|---|---|
| `uncommitted work in a local worktree` | Files edited on this machine — the strongest evidence there is |
| `last commit 3 min ago` | A commit inside the quiet window |
| `claimed, no commits yet` | A fresh claim: an agent reading the plan, or one that never started |

The third is the weakest, and it is tempting to grade the animation by
confidence — faster for a dirty worktree, slower for a bare claim. That is
rejected. **Group membership is the statement, and it is true for all three**:
each is a reason the fleet considers this branch live. The note beside it
already says *which* reason, so a second vocabulary made of speeds would encode
what the text states plainly — and speed is unreadable in isolation and
invisible in a screenshot, which this repo takes seriously enough to have
written it into the contract for colour.

So: **one animation, for the whole group, while the row is in it.** It stops
when the row leaves — which is exactly when the work stopped or moved on.

### A pulsing dot, not a spinner

A small dot before the row, breathing gently between two opacities.

Spinners were considered and dropped on a plain count: `WORKING` regularly holds
several rows — four agents ran in parallel this evening — and four rotating
spinners in a column is flicker, not information. Rotation also implies
*progress toward completion*, which nothing here measures; a pulse implies
*aliveness*, which is exactly the claim being made.

It sits **before** the row rather than inside the note, because the note is
where the row states its facts, and motion there competes with reading them. A
leading dot needs no column of its own and scales from one row to eight.

### Reduced motion is built in, not retrofitted

`prefers-reduced-motion: reduce` disables the animation and leaves the dot
static. Two lines of CSS, and the reason is not politeness: motion triggers
nausea for some readers, and this view is meant to be left open on a second
screen.

The state stays fully legible without it — group, note and age all say what the
row is doing. The animation is decoration on top of information, never the
carrier of it, which is the rule the contract already sets for colour: *"carried
as a symbol AND a word, never as colour alone."* The same test applies here, and
this plan passes it by design rather than by luck.

### Dormant groups start collapsed, and remember

Every group header becomes a toggle. `quiet` and `done` start **collapsed**;
everything else starts open.

That default is not a preference, it is the existing group order made
effective. The list is already sorted actionable-before-diagnostic, and those
two are the diagnostic end — one means *go check whether this died*, the other
*this is finished*. Neither needs to be read on arrival, and between them they
were costing twenty rows this evening.

**The header keeps its count when collapsed.** `QUIET (7)` collapsed states
plainly that seven rows are hidden; a collapsed header without a number reads
as *nothing here*, which is the failure this must not introduce. The count is
already rendered, so it simply must not be hidden with the body.

**The state persists in `localStorage`.** Someone who opens `QUIET` usually
wants it to stay open — and this board is left running and reloaded often,
several times an hour during development. Without persistence the reader
re-configures the view every time, which teaches them not to bother.

**Collapsing is manual, never automatic.** An earlier option was to fold groups
that hold nothing actionable, dynamically. Rejected: the pulse re-scans every
five seconds, so rows would appear and vanish under the cursor and the page
would jump while being read. A view meant to sit beside your work must not move
its own furniture.

## Branches

### Motion

- `feature/working-rows-pulse` — a pulsing dot on `working` rows, one animation
  for the whole group, disabled under `prefers-reduced-motion`

### Density

- `feature/agent-groups-collapse` — group headers toggle; `quiet` and `done`
  start collapsed with their counts still visible; the state persists in
  `localStorage`

Two branches, and they are independent: one touches a row, the other a section
header. Either is useful without the other.

## Done when

- **A `working` row renders an animated indicator**, and rows in every other
  group do not. Assert the negative too: a `quiet` row that also has a recent
  claim must stay still.
- **All three `working` notes get the same indicator.** Assert
  `uncommitted work…`, `last commit…` and `claimed, no commits yet` render
  identically — a confidence-graded implementation passes a test that only
  checks one of them.
- **The indicator disappears when the row leaves the group**, asserted across a
  state change rather than on a static fixture.
- **`prefers-reduced-motion: reduce` disables the animation** and the dot stays
  visible. Assert both halves: removing the element entirely would lose the
  marker along with the motion.
- **The row is fully legible with animation off.** Assert group, note and age
  are unchanged — the animation must never be the only carrier of a fact.
- **`quiet` and `done` start collapsed; every other group starts open.** Assert
  both halves — a blanket default passes a test that only checks one group.
- **A collapsed header still shows its count.** Assert `(7)` is present with
  the body hidden: a collapsed header without a number reads as *nothing here*,
  which is worse than the crowding it fixes.
- **The state survives a reload.** Assert via `localStorage`, and assert the
  default applies when nothing is stored — a first visit must not depend on
  state that does not exist yet.
- **Nothing collapses by itself.** Assert that a group whose rows all become
  quiet stays open if the reader opened it: the pulse re-scans every five
  seconds, and a view that folds itself while being read moves the line under
  the cursor.
- **The footer is reachable without scrolling past a collapsed group.** The
  measurable form of the original complaint.
- `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`, `pnpm run validate`
  all pass.
- `pnpm build:board` run in the implementing worktree and the artifact
  committed — CI gates on no-diff.
- A changeset is present.

## Notes

Both halves asked for directly on 2026-08-16, minutes apart and from the same
screenshot: *can the Agents view have more micro animations, so the UI shows
that something is happening?* and *the sections should be collapsible — I can
no longer see the status line.*

The first answer drafted here was too cautious — it treated any moving
indicator as a truth claim the board could not support, by analogy with the
countdown that kept ticking after its server died
([`board-tells-the-truth`](2026-08-16-board-tells-the-truth.md)). The analogy
does not hold: that countdown asserted a *specific future event* ("next in 0s")
that was not coming. A pulse on a `WORKING` row asserts only that the row is in
`WORKING`, which is true by construction and re-derived every five seconds.

Deliberately not in scope: motion tied to *observed change between scans* — a
row lighting up when its commit age resets or its group flips. That is a
different and larger idea (it needs the previous payload retained client-side),
and it answers "what just changed" rather than "what is alive". Worth its own
plan if the pulse proves useful.
