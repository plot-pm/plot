# Activity shows itself, at the row and at the fold

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

Asked on 2026-08-17: *can the activity indication be more prominent —
pulsing, moving, with a glow — so activity on the board is easier to
spot?* And a moment later, the sharper half: *can the group carry a
marker too, so activity is visible while the group is collapsed?*

Both are real. The measurement says the first one needs a different fix
than the one proposed, and the second one exposes a gap nothing covers
today.

### The dot is not too quiet; it is too uninformed

Measured — `AgentList.tsx:472`, the whole of it:

```ts
export function isLive(row: AgentRow): boolean {
  return row.group === 'working';
}
```

The dot does not say *something is happening here*. It says *this row is
in the WORKING group* — and a row can sit there for **hours** while an
agent works, while an agent has crashed, or while it waits on a human.
Nothing measures the end. Six rows carried it during this session.

So making it glow and travel would amplify a claim the board cannot
support. Six simultaneously glowing, sliding rows would assert progress
six times over, and progress is precisely what nothing here measures.
`working-rows-show-motion` already settled the underlying rule — rotation
*"implies progress toward completion, which nothing here measures"* — and
a left-to-right travelling motion makes the same promise horizontally.

**A glow is different and is fine.** It says *there is more going on here
than there*, without claiming an end. That is a statement the board can
support — once it has something true to say.

### The board already knows, and shows none of it

Measured: the contract carries three activity fields, and **not one
reaches any component**:

| Field | The question it answers |
|---|---|
| `local_dirty` | someone is editing |
| `local_ahead` | finished work nobody else can see |
| `local_locked` | a write is in progress **this instant** |

`local_locked` is literally *something is happening right now* — it reads
`.git/index.lock` — and it was fought for earlier the same day in
`board-survives-its-agents`, whose whole argument was that a locked
worktree must become its own signal rather than silence. It landed in the
contract and stops there.

So the honest question is not *how do we make the dot louder?* but *what
do we actually know about this row that deserves the eye?*

### A collapsed group reports its stock, not its motion

Measured — the folded heading renders `tally`:

```tsx
{rows.length > 0 ? `(${rows.length})` : hint}
```

`(4)` means *four rows are in here*. It does not mean any of them is
moving. And the comment above it says why the number exists at all:
*"a folded header with no number reads as nothing here"* — it was
introduced to separate **absence from emptiness**, not to report change.
It is the same shape as the dot: a count reporting membership where the
reader is looking for activity.

This is not hypothetical. **QUIET and DONE start collapsed** by default,
and the choice is persisted in `localStorage`, so it stays collapsed
across sessions. The comment names QUIET's purpose exactly: *"go check
whether this died"*. A group whose entire job is to surface possible
deaths is folded shut by default and shows only a stock count.

## Design

### The marker reads what is true, before it gets loud

The row's activity marker stops reading `group === 'working'` and reads
the three fields the board already has. **A row is active when
`local_locked` or `local_dirty` holds** — someone is writing, or has
written and not committed.

`local_ahead` is deliberately **not** activity: unpushed commits are
finished work sitting still, which is a different problem with a
different remedy (push it) and no motion behind it. It stays available
for the note, which already carries facts a marker cannot.

**Absent is not false.** All three are `.default(false)` in the contract,
and a scan that could not observe a worktree reports absence rather than
cleanliness — the rule `scan-reports-a-locked-worktree` established. A
row whose signals are unknown is **not** marked active; it is marked
nothing, and the note keeps saying what it always said.

**The group membership stays visible.** WORKING still means what it
meant; what changes is that a row *inside* it now distinguishes *a write
is happening* from *this has been sitting here for three hours*. The
group is the address; the marker is the pulse.

### The marker is a breathing bar on the left edge, not a tint

**Measured constraint, not a preference.** The row's whole surface is
already claimed: the change-marker being built in
`status-column-earns-its-width` renders as

```
absolute inset-0 animate-pulse bg-amber-300/25
```

— area, amber, and pulse, for *this just changed*. Two markers competing
for the same pixels would let the permanent one bury the rare one, and
the rare one is the more urgent.

So activity takes **form** where the change-marker takes **area**: a
narrow vertical bar at the row's left edge, emerald, with a soft glow and
a slow breathing animation. The left edge is already this marker's home —
the current dot hangs in the row's left padding via `sm:absolute`,
outside the six grid tracks, precisely so it costs no column.

| Marker | Channel | Means | Lifetime |
|---|---|---|---|
| Change-mark (#178) | full-row amber wash, pulse | *this just changed* | ~3 s |
| **Activity bar** | **left edge, emerald, glow** | *someone is writing here* | as long as it holds |
| `LiveDot` today | 6 px dot | *in the WORKING group* | hours |

A bar rather than a bigger dot because the reported problem is spotting
it *from a distance*: a vertical stroke at a fixed x reads as a mark down
the side of the list, where a dot must be hunted. And because the bar
scales to the next section — a heading can carry the same stroke, a dot
in a heading would read as a bullet.

**Breathing, not travelling.** The animation stays a pulse for the reason
already recorded: motion that traverses implies a destination, and this
has none. The glow supplies the prominence the travel was meant to
supply.

**`motion-reduce` keeps the bar and stops the animation** — both halves,
the rule this repo has now applied three times.

**`aria-hidden`.** The row's note already says what is happening in
words; a screen reader must not hear it twice. The same reasoning the
current dot documents for itself.

### A collapsed group carries the marker for its rows

When any row inside a group is active, the group's heading carries the
same bar — the same shape, the same colour, one level up. **Binary: at
least one row is active, or none is.**

**No second number.** `(4, 2 active)` was the alternative and is
rejected: `(4)` exists to separate *absent* from *empty*, a distinction
this board paid for, and a second figure beside it dilutes the one job
that number has. The reader opening a group does not need to know whether
it is one row or three — they need to know whether opening it is worth
it.

**The heading carries it whether folded or open.** Hiding it when
expanded was considered — the rows show it themselves, so the heading
would be redundant — and rejected because the marker would then vanish at
the moment of expanding, which reads as *it stopped*. A marker that
disappears when you look closer is worse than one that repeats itself.

**It is derived, never stored.** The heading's marker is
`rows.some(isActive)` computed at render, from the same pulse the rows
read. No new field, no new state, and it cannot disagree with the rows
beneath it — the way a separately-maintained count could.

### What this does not do

**No travelling motion.** Explicitly considered and rejected above.

**No new data.** All three fields exist in the contract today; the whole
change is that two of them reach the screen.

**No change to grouping.** `classify()` is untouched: a row's group is
where it belongs, and this is about what it is doing there.

## Branches

### Truth

- `feature/rows-mark-real-activity` — the row's marker reads
  `local_locked || local_dirty` instead of `group === 'working'`, absent
  stays unmarked, `local_ahead` deliberately excluded

### Prominence

- `feature/activity-marker-glows` — the marker becomes a breathing,
  glowing bar on the left edge; `motion-reduce` keeps it and stops the
  animation; `aria-hidden`

### Fold

- `feature/group-shows-inner-activity` — the group heading carries the
  same bar when any of its rows is active, derived at render, folded or
  open

Three waves, sequential, and the order is the one this session has now
paid for twice. **Truth first**: a glowing marker over
`group === 'working'` would be, in the words the spinner plan used for
the same mistake, *a livelier lie* — which is exactly why #174 (watch the
right count) had to land before #176 (the spinner). **Prominence second**,
once there is something true to make loud. **Fold last**, because a group
cannot say *activity in here* until a row can say *activity*.

All three touch `AgentList.tsx`, and every board branch rebuilds the
artifact. This session paid four manual conflict resolutions in one hour
for branches meeting in the same objects, and both #176 and #177 needed a
further rebase on the artifact alone.

**`status-column-earns-its-width` is in flight in this same file** and
owns the full-row amber wash. Wave 1 here can start alongside it — it
changes a predicate, not a rendering — but waves 2 and 3 must rebase onto
it, and must not touch `data-change-mark`.

## Done when

- **The row marker reads `local_locked || local_dirty`**, not
  `group === 'working'`. Assert a WORKING row with neither signal is
  **not** marked, and a marked row outside WORKING is.
- **`local_ahead` alone does not mark a row active.** The pairing: an
  implementation OR-ing all three passes every positive assertion above
  and marks finished-but-unpushed work as motion.
- **Unknown signals leave a row unmarked.** Assert absence reads as *not
  known to be active*, never as active — and never crashes: all three are
  `.default(false)` and a scan that could not observe reports absence.
- **The activity marker and the change-mark are distinguishable.** Assert
  both present on one row produce two distinct marks — a row can be
  written to *and* have just changed state, and one marker for both would
  lose whichever fired second.
- **The change-mark's channel is untouched.** Assert `data-change-mark`
  still renders as the full-row wash — the pairing that matters, since
  the cheap way to make activity prominent is to reuse that surface.
- **`motion-reduce` keeps the bar and stops the animation.** Both halves.
- **The marker is `aria-hidden`** and the note still carries the fact in
  words.
- **A collapsed group with an active row carries the marker.** Assert
  against a folded group — the reported case, and the one no test covers
  today.
- **A collapsed group with no active row carries nothing.** Assert the
  absence: a heading that always shows the mark says nothing.
- **The heading keeps the marker when expanded.** The pairing: hiding it
  on expand passes the collapsed assertion and makes the mark read as
  *stopped* at the moment of opening.
- **The heading's marker cannot disagree with its rows.** Assert it is
  derived from the same rows at render — no separate count, no stored
  state.
- **`(4)` still means what it meant.** Assert the tally is unchanged: it
  separates absent from empty, and that job is not being extended.
- `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`,
  `pnpm run validate` all pass.
- `pnpm build:board` run in the implementing worktree and the artifact
  committed — CI gates on no-diff.
- A changeset is present, with its `bumps:` block.

## Notes

The request arrived as *"pulsing, left-right movement, with glow"*. Two
of the three are adopted; the travelling motion is not, and the reason is
recorded above rather than left as a silent omission: it promises a
destination this board cannot name. The glow is what supplies the
prominence the movement was asked to supply.

`local_ahead` reaching the screen is worth its own consideration later —
*finished work nobody else can see* is a real condition with a real
remedy, and this session watched it cost PR #177 half an hour of dead CI
when a rebase stayed local. It is not activity, so it is not here.
