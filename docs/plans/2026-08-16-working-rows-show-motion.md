# A tab about live work that holds still and buries its own status

## Status

- **Phase:** Approved
- **Type:** feature
- **Sprint:**
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:** 2026-08-16, jwloka, plan-PR #145 merged
- **Started:** 2026-08-17, Jan Wloka, `feature/working-rows-pulse`
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

A small dot before the row, breathing gently between two opacities —
Tailwind's own `animate-pulse` with `motion-reduce:animate-none`, not a
hand-written keyframe. This is the board's first animation, so the smallest
possible introduction is the right one: no new CSS file, no keyframe
definition, and the reduced-motion variant comes with the utility rather than
needing its own media query.

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

**No visibility handling.** A pure CSS animation costs effectively nothing, and
browsers already throttle background tabs. Pausing it via the Page Visibility
API would add a mechanism for a problem the platform solves — and the poll
cycle, which is the expensive part, keeps running anyway.

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

**An empty group never collapses**, and the header explains why: it renders
`rows.length > 0 ? '(N)' : hint`, so an empty `QUIET` shows *still thinking, or
dead?* rather than `(0)`. The hint is the *explanation for emptiness*, not a
subtitle — and it is exactly what a reader wants when there is nothing to list.
A collapse control on a group with nothing to hide is an offer that leads
nowhere, the same class of defect as a button that declines its own action.

**A row falling into a collapsed group changes the count and nothing else.**
`QUIET (7)` becomes `QUIET (8)`. No flash, no auto-expand: the pulse re-scans
every five seconds, and `quiet` is by construction the group whose changes are
least urgent. Someone who collapsed it was asking not to be interrupted by it,
and a view that reopens itself mid-read moves the line under the cursor — the
same reason collapsing is manual.

**The state persists in `localStorage`, and that is a deliberate departure.**
The board already has a convention for view state and it is the **URL**:
`?tab=agents`, `?lanes=1`, `?plan=…`, written with `history.replaceState`.
There is no `localStorage` anywhere in the app today, so this introduces a
second mechanism for what looks like the same kind of state — exactly the
duplication this codebase otherwise refuses (`toBoardPhase` has one
implementation; the eligible note became a shared constant rather than a
repeated string).

The distinction that justifies it: **a URL is shareable, and collapse state
should not be.** Everything currently in the query string is worth sending to
someone — *look at this plan*, *look at the agents tab*, *look at the
swimlanes*. A link carrying `?collapsed=quiet,done` would hand my personal
tidying to whoever opens it, rebuilding their view as a side effect of "have a
look at this". Collapse is convenience, not subject matter.

Persistence itself is not optional: this board is left running and reloaded
several times an hour during development. Without it the reader re-configures
the view every time, which teaches them not to bother.

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

Two branches, useful independently — one touches a row, the other a section
header — but **sequential, motion first**. They edit the same component, and
this repo has paid three times today for two agents in one file, even at
different lines. Motion is the smaller change (one element, one utility class),
so it goes first and the collapse branch rebases onto it.

The `sr-only` label and the dot must not compete: a screen reader hears the
group heading and the row's own text, so the dot is decorative and gets
`aria-hidden`. The animation carries nothing a reader without it would miss.

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
- **Collapse state never reaches the URL.** Assert the query string is
  unchanged by toggling: a shared link must not rebuild the recipient's view.
- **An empty `WORKING` group animates nothing.** Trivial by construction — the
  dot sits on a row — but assert it, so nobody later moves the animation to the
  group header where it would run against zero rows.
- **The dot is `aria-hidden`.** It is decorative; the group heading and the
  row's text already carry the meaning.
- **Nothing collapses by itself.** Assert that a group whose rows all become
  quiet stays open if the reader opened it: the pulse re-scans every five
  seconds, and a view that folds itself while being read moves the line under
  the cursor.
- **An empty group renders no collapse control**, and still shows its hint
  rather than `(0)`. Assert both — a blanket toggle passes the first half of
  this and quietly hides the hint.
- **A row entering a collapsed group updates the count without expanding it.**
  Assert the group is still collapsed afterwards: auto-expanding passes a naive
  "the new row is visible" test and breaks the reading position.
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

Ordering: both branches touch `AgentList.tsx`, which
[`agent-view-phase`](2026-08-16-agent-view-phase.md)'s Display wave holds while
it is in flight. Approved but not dispatched until that merges — a fourth agent
in the same file is the collision this repo has paid for twice today.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 2,
  "questionHistory": [
    {"q": "Should the animation be graded by confidence? WORKING has three entrances of differing strength.", "a": "No — one animation for the group. Membership IS the statement and it is true for all three; the note already says which reason, and speed is unreadable in isolation and invisible in a screenshot", "category": "ux-happyPath"},
    {"q": "Spinner or pulse?", "a": "Pulsing dot before the row. WORKING regularly holds several rows — four agents ran in parallel this evening — and four rotating spinners is flicker. Rotation also implies progress toward completion, which nothing here measures", "category": "ux-happyPath"},
    {"q": "prefers-reduced-motion, with no existing convention in the board?", "a": "Built in from the start. Two lines of CSS; motion triggers nausea for some readers, and animation must never be the only carrier of a fact — the rule the contract already sets for colour", "category": "ux-accessibility"},
    {"q": "The header renders `rows.length > 0 ? '(N)' : hint` — what happens to EMPTY groups on collapse?", "a": "Empty groups never collapse. They hide nothing, and the hint is the information one wants when there is nothing to list. A control on a group with nothing to hide is an offer leading nowhere", "category": "ux-edgeCases"},
    {"q": "A row falls into a COLLAPSED group — visible how?", "a": "The count changes, nothing else. No flash, no auto-expand: quiet is by construction the least urgent group, and a view that reopens itself mid-read moves the line under the cursor", "category": "ux-edgeCases"},
    {"q": "Pause the animation when the tab is hidden?", "a": "No. Pure CSS costs nothing and browsers throttle background tabs already; the poll cycle is the expensive part and keeps running regardless", "category": "nonfunctional-performance"},
    {"q": "The board keeps view state in the URL (?tab, ?lanes, ?plan) and uses no localStorage anywhere. The plan mandates localStorage — a second mechanism for the same kind of state?", "a": "localStorage, but say why: a URL is SHAREABLE and collapse state should not be. Everything in the query string is worth sending to someone; ?collapsed=quiet,done would rebuild the recipient's view as a side effect of 'have a look at this'", "category": "technical-architecture"},
    {"q": "Where does the keyframe live, given the board has no animations at all?", "a": "Tailwind's animate-pulse with motion-reduce:animate-none — no new CSS file, no keyframe definition, and the reduced-motion variant comes with the utility. Smallest possible way to introduce the first animation", "category": "technical-stack"},
    {"q": "Both branches touch AgentList.tsx. Dispatch in parallel?", "a": "Sequential, motion first. Same component, and this repo paid three times today for two agents in one file even at different lines. Motion is smaller; collapse rebases onto it", "category": "tradeoffs-ordering"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": true, "architecture": true, "implementation": true},
    "domain": {"rules": true, "workflows": false, "data": false},
    "ux": {"happyPath": true, "edgeCases": true, "errors": false, "accessibility": true},
    "nonFunctional": {"security": false, "performance": true, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
