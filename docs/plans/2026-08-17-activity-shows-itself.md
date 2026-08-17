# Activity shows itself, at the row and at the fold

## Status

- **Phase:** Approved
- **Type:** feature
- **Sprint:**
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:** 2026-08-17, Jan Wloka, plan-PR #179 merged
- **Started:** 2026-08-17, Jan Wloka, `feature/rows-mark-real-activity`
- **Delivered:**
- **Started:** 2026-08-17, Jan Wloka, `feature/activity-marker-glows`
- **Started:** 2026-08-17, Jan Wloka, `feature/group-shows-inner-activity`

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

The request's third element, *pulsing*, is not adopted either, and for a
reason the row itself supplies: after #180 there are **already two
pulsing elements on a row** — the 6 px `[data-live-dot]` and the full-row
`[data-change-mark]` wash. A third pulse at a third scale competes rather
than adds. The glow is what carries the prominence all three were asked
to carry.

### The board already knows, and shows none of it

Measured: the contract carries three activity fields, and **not one
reaches any component** — they stop one layer short. They live on
`FleetBranchSchema` (the scan document), are passed to `classify()` in
`rowsFromPulse` (`fleet.ts:1224-1238`), and are then **dropped**:
`AgentRowSchema` carries none of them, and `AgentRow` is what the
component receives. So wave 1 must add a carrier — the two activity
fields onto the row schema, additively — before any predicate can read
them.

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
different remedy (push it) and no motion behind it. It earns its own
static mark rather than exclusion — see *Unpushed work gets a mark of its
own* below.

### The marker means "here, on this machine", and must say so

**Measured, and it narrows the whole feature** — `fleet.ts:702`, on
`local_dirty`, with the same note on `local_ahead`:

> *"it is true only on the machine doing the looking, and false is what
> every branch elsewhere reports."*

So an agent running on another machine — or in the cloud — produces **no
dirty signal here, ever**. Its branch is not quiet; it is unobservable
from this checkout. `local_locked` shares the limit: it reads
`.git/index.lock` in a local worktree.

The marker therefore claims exactly what it can support: **activity in
this checkout**. A branch worked on elsewhere stays unmarked, and that
absence means *not visible from here* — never *not happening*.

**This must reach the reader, not just this plan.** The marker carries it
in its `title`/accessible description (*"a write is in progress in this
checkout"*), because a reader who takes an unmarked row for an idle one
has been misled by a marker that was technically correct. This is the
same rule the scan applies to itself — `ABSENT IS NOT FALSE`, and its
strongest licensed statement is **unknown, never nobody**.

A remote-visible signal — deriving activity from ref movement between
pulses — was considered and rejected for this plan. It answers a
different question (*the remote moved*) with a different meaning (someone
pushed, possibly hours ago, possibly a bot), and folding it into the same
marker would give one mark two meanings across two trust levels. If
cross-machine visibility is wanted, it deserves its own signal and its
own argument.

### A lock outlives its instant, by a few seconds

**Measured tension:** `.git/index.lock` exists for a fraction of a second
to a few seconds — a commit, a rebase step — and the fleet pulse arrives
every **4 s**. So most locks are born and gone *between* two pulses and
are never seen. The sharpest activity signal the board has is also the
one it most often misses.

So a lock, once seen, **holds the marker for a few seconds** past the
pulse that reported it, the way the change-mark in
`status-column-earns-its-width` holds for ~3 s.

**This is a deliberate exception to a rule this board otherwise keeps,
and it must be bounded.** For those seconds the marker outlives the fact:
the lock may already be gone. Three constraints keep that honest:

- **It never contradicts a later observation.** A pulse showing
  `local_dirty` keeps the marker for its own reason; a pulse showing
  neither ends the echo when the echo expires, and does not extend it.
- **A lock never resurrects.** The echo starts when a lock is *seen*, not
  when one is inferred; two pulses without a lock produce nothing to
  echo.
- **It is a marker, not a state.** The row's note — which the marker
  never replaces — continues to report what the last pulse actually
  found. The echo makes a real event visible; it does not make a claim
  the note would contradict.

Not echoing was the alternative and would have been simpler: let
`local_dirty` carry the load, since it holds for minutes. Rejected
because it discards precisely the *"a write is happening this instant"*
signal that `scan-reports-a-locked-worktree` was built to produce — the
plan whose entire argument was that a locked worktree must become its own
signal rather than silence. Producing it and then never rendering it is a
quieter version of the same defect.

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

| Marker | Selector | Channel | Means | Lifetime |
|---|---|---|---|---|
| Change-mark (#180) | `[data-change-mark]` | full-row amber wash, **pulse** | *this just changed* | ~3 s |
| `LiveDot` | `[data-live-dot]` | 6 px dot, **pulse** | *in the WORKING group* | hours |
| **Activity bar** | new | **left edge, emerald, glow, static** | *someone is writing here* | while it holds |
| **Unpushed mark** | new | **left edge, outlined, no glow, static** | *commits nobody else can see* | while it holds |

**Four marks can hold on one row at once**, and #180 already ships a test
for two of them coexisting — *"leaves the LIVE DOT alone — two marks, two
meanings"*. That precedent is the standard: every pair must stay
distinguishable, and no mark may be implemented by modifying another.

The `<li>`'s own background is deliberately left free. #180's wash is an
**overlay** at 20–25 % alpha rather than a background on the row, so a
real `bg-*` on the `<li>` would compose beneath it — but amber over a
tint reads muddy, which is a second reason this plan takes the edge
rather than the surface.

A bar rather than a bigger dot because the reported problem is spotting
it *from a distance*: a vertical stroke at a fixed x reads as a mark down
the side of the list, where a dot must be hunted. And because the bar
scales to the next section — a heading can carry the same stroke, a dot
in a heading would read as a bullet.

**Static, not breathing — and this reverses the plan's first draft.**
The draft said *breathing*, on the reasoning that a pulse is this board's
established vocabulary for aliveness. Measured against the row as it
actually stands after #180, that is wrong: **two elements on a row
already pulse** — `[data-live-dot]` at 6 px and `[data-change-mark]` as a
full-row wash — and this would be the third, at a third scale. Three
things pulsing at three sizes on one row do not add up to *more visible*;
they compete.

The ordering principle that settles it: **a fact true for hours has less
claim on motion than a fact true for three seconds.** Motion is the
scarce channel, and the transient marks should hold it. Activity is
persistent by nature — someone is writing, and will be for a while — so
it takes **presence** instead: a bar that is simply *there*, with the
glow supplying the prominence, and its appearance and disappearance
carrying the change.

This also removes the travelling motion the request asked for, and for a
second reason beyond the one above: motion that traverses implies a
destination, and this has none.

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

### Unpushed work gets a mark of its own — static, not breathing

`local_ahead` is not activity, and it is not nothing. It means **finished
work nobody else can see**, and this session measured what that costs:
PR #177 sat `CONFLICTING` with no CI running for half an hour because a
rebase stayed local. From the outside that is indistinguishable from an
agent that stopped — and the fleet view exists precisely to tell those
apart.

Both marks are static, so **colour and shape carry the difference**, not
motion. Once the activity bar stopped breathing (above), *still versus
moving* was no longer available as a distinction — and reaching for it
anyway would have re-introduced the third pulse that decision removed.

| Mark | Means | Form |
|---|---|---|
| Activity bar | someone is writing here | solid bar, emerald, glowing |
| Unpushed mark | finished work nobody else can see | hollow/outlined bar, amber-free hue, no glow |

The glow is what separates them at a glance: activity has it, stillness
does not. A reader who learns *glow = someone is here* reads both marks
from one rule.

**They can hold at once**, and must remain distinguishable then: a
worktree that is dirty *and* ahead is being edited *and* hiding commits.
Collapsing them into one mark would lose whichever the implementation
happened to check second.

This shares the local-only limit above and says so the same way.

### What this does not do

**No travelling motion.** Explicitly considered and rejected above.

**No new data.** All three fields are produced by the scan today. Wave 1
adds a *carrier* for two of them onto `AgentRowSchema` — additively,
`.default(false)` — because the row does not currently receive them.
Nothing new is measured, computed, or asked of git.

**No change to grouping.** `classify()` is untouched: a row's group is
where it belongs, and this is about what it is doing there.

## Branches

### Truth

- `feature/rows-mark-real-activity` — the row's marker reads
  `local_locked || local_dirty` instead of `group === 'working'`; a seen
  lock echoes for a few seconds; absent stays unmarked; the marker names
  its own limit (*in this checkout*) → #182

### Prominence

- `feature/activity-marker-glows` — the marker becomes a glowing,
  **static** bar on the left edge; no animation, because two elements on
  the row already pulse; `aria-hidden` → #189

### Fold

- `feature/group-shows-inner-activity` — the group heading carries the
  same bar when any of its rows is active, derived at render, folded or
  open

### Stillness

- `feature/unpushed-work-shows-still` — `local_ahead` gets its own mark
  at the same left edge, separated from the activity bar by form and the
  absence of the glow; distinguishable when both hold at once

Four waves, sequential, and the order is the one this session has now
paid for twice. **Truth first**: a glowing marker over
`group === 'working'` would be, in the words the spinner plan used for
the same mistake, *a livelier lie* — which is exactly why #174 (watch the
right count) had to land before #176 (the spinner). **Prominence second**,
once there is something true to make loud. **Fold third**, because a
group cannot say *activity in here* until a row can say *activity*.
**Stillness last**, because it is defined by contrast with the activity
bar — its hue and form only make sense once that bar has settled.

**Nothing starts until `status-column-earns-its-width` (#178) has
merged.** All four waves touch `AgentList.tsx`, which that branch is
rewriting right now — it owns the full-row amber wash
(`data-change-mark`, `absolute inset-0 animate-pulse bg-amber-300/25`)
and has already changed `ROW_TRACKS`.

Starting wave 1 alongside it was the tempting call, on the grounds that
it changes a predicate rather than a rendering. Rejected on the
measurement: this session paid **four** manual conflict resolutions in
one hour for branches meeting in the same objects — every one a union
with no genuine disagreement — and #176 and #177 each needed a further
rebase on the artifact alone. Two branches in one file buy a head start
and pay for it twice.

Later waves must not touch `data-change-mark`: the change-mark owns area,
amber and pulse; this plan's marks own the left edge.

## Done when

- **The row marker reads `local_locked || local_dirty`**, not
  `group === 'working'`. Assert a WORKING row with neither signal is
  **not** marked, and a marked row outside WORKING is.
- **`local_ahead` alone does not mark a row ACTIVE.** The pairing: an
  implementation OR-ing all three passes every positive assertion above
  and marks finished-but-unpushed work as motion.
- **`local_ahead` alone DOES produce the unpushed mark**, and it is
  distinguishable from the activity bar by form and glow rather than by
  motion — both are static.
- **Active and unpushed together produce two distinguishable marks.**
  Assert a row that is dirty *and* ahead: an implementation checking them
  in sequence loses whichever it tests second.
- **A seen lock keeps the marker for a few seconds.** Assert the marker
  survives a pulse in which the lock is already gone — a lock's whole
  life is often shorter than the 4 s pulse, which is why the signal
  `scan-reports-a-locked-worktree` produced would otherwise never render.
- **The echo is bounded and never resurrects.** Assert it expires without
  a further lock, and that two lockless pulses produce no marker at all.
- **A later observation is never contradicted.** Assert the note keeps
  reporting what the last pulse found while an echo is running — the echo
  makes an event visible, it does not overwrite a fact.
- **The marker names its own limit.** Assert its accessible description
  says the observation is about *this checkout* — a branch worked on
  elsewhere is unmarked, and a reader taking that for idle has been
  misled by a technically-correct marker.
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
- **The activity bar does not pulse.** Assert no `animate-*` on it: two
  elements on the row already pulse (`[data-live-dot]`, `[data-change-mark]`)
  and a third at a third scale competes rather than adds. The pairing that
  matters: an implementation reaching for `animate-pulse` because the board
  uses it elsewhere passes every visibility assertion and makes the row
  noisier, not clearer.
- **`motion-reduce` leaves the marks unchanged**, because neither animates —
  and assert the glow survives it: a reduced-motion rule that strips the glow
  would take the distinction between the two marks with it.
- **All four marks stay distinguishable on one row.** Assert a WORKING row
  that is dirty, ahead, and whose PR just changed carries `[data-live-dot]`,
  `[data-change-mark]`, the activity bar and the unpushed mark, all distinct.
  #180 ships the two-mark precedent; this extends it.
- **No existing mark is modified.** Assert `[data-change-mark]` and
  `[data-live-dot]` render exactly as before — the cheap way to make activity
  prominent is to repaint one of them.
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

The first draft excluded `local_ahead` entirely, on the grounds that it
is not activity. Interrogation kept the distinction and dropped the
exclusion: it is not activity, and it is not nothing. It became a fourth
wave with a **static** mark, because *finished work nobody else can see*
is a real condition with a real remedy — and this session watched it cost
PR #177 half an hour of dead CI when a rebase stayed local.

Two limits found by interrogation are worth restating, because both
narrow what this feature can honestly claim:

- **Every signal here is local.** `fleet.ts:702` is explicit that these
  are *"true only on the machine doing the looking"*. An agent on another
  machine produces no mark. The marker says so rather than letting
  absence read as idleness.
- **The lock echo is the one place this board lets a marker outlive its
  fact**, bounded to a few seconds and never contradicting the note.
  Without it the sharpest signal the board has — a write happening *this
  instant* — would remain invisible, because it usually lives and dies
  between two pulses.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 2,
  "questionHistory": [
    {"q": "local_dirty/ahead are true only on the observing machine — what follows?", "a": "The marker claims 'in this checkout' and says so; absence means unobservable, not idle", "category": "domain"},
    {"q": "A lock often lives and dies between two 4s pulses — how to surface it?", "a": "Echo a seen lock for a few seconds, bounded, never contradicting the note", "category": "technical"},
    {"q": "local_ahead excluded — but it cost #177 half an hour of dead CI?", "a": "Its own static mark, no animation; stillness IS the message", "category": "ux"},
    {"q": "Can wave 1 run alongside #178 in the same file?", "a": "No — wait for the merge; four conflict resolutions in one hour say otherwise", "category": "tradeOffs"},
    {"q": "Should the activity bar pulse, as the request asked?", "a": "No — two elements already pulse after #180; a fact true for hours has less claim on motion than one true for 3s", "category": "ux"},
    {"q": "If the activity bar is static too, what separates it from the unpushed mark?", "a": "Form and the glow, not motion — glow means someone is here", "category": "ux"}
  ],
  "categoriesCovered": {
    "technical": {"stack": true, "architecture": true, "implementation": true},
    "domain": {"rules": true},
    "ux": {"happyPath": true, "edgeCases": true, "accessibility": true},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
