# A working row shows its pace, and flashes when something is written

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

Asked on 2026-08-17, looking at WORKING with two agents running: *the
glowing bar could be a horizontal bar with a glowing dot travelling left
to right and back — a little more attention, on every working line. And
the whole line could highlight on every written update, the way other
sections already do.*

Two requests, and the measurement supports both — with one boundary the
second one needs.

### The bar is honest and easy to miss

`activity-shows-itself` landed today and fixed what the marker *means*:
it reads `local_locked || local_dirty` — *someone is writing here* — and
no longer `group === 'working'`, which was true for hours whether an
agent was working, crashed, or waiting.

Measured in the reported pulse, the two WORKING rows are **not the same**:

```
feature/not-started-counts-plans  dirty=true   note="last commit 18 min ago"
bug/green-never-outranks-unknown  dirty=false  note="claimed, no known worker"
```

The first has an agent demonstrably writing. The second is claimed and
the board **does not know** whether anyone is there. The marker already
tells them apart — a bar on one, a dot on the other — and that
distinction is the thing to protect.

What it does not do is carry across a glance. It is a 4 px stroke in the
row's left padding, and the report is exactly that it is easy to miss.

### Travel is not the motion this repo rejected

Rotation and travel were turned down twice, with one reason: they
*"imply progress toward completion, which nothing here measures"*. An
agent in WORKING may finish in five minutes or five hours.

**A dot that goes left, then right, then left again never arrives.** It
promises no destination, which is precisely why it clears the bar the
rejected motions did not. It says *something is going on here*, at a
speed, and stops there.

### The whole-line flash exists — and cannot see a commit

`data-change-mark` is built: a full-row amber wash, `absolute inset-0`,
~3 s. It fires on a change to one value:

```ts
export function watchedState(row: AgentRow): WatchedState {
  return row.pr?.state ?? null;
}
```

**A new commit does not move `pr.state`.** So the most common written
update on this board — an agent pushing work — produces no flash at all,
while a CI transition does. The mechanism is right and the input is too
narrow.

## Design

### The marker becomes a track with a travelling dot, at two speeds

A short horizontal track where the bar is today, with a glowing dot
travelling along it and back. Two speeds, both earned:

| Row | Speed | Because |
|---|---|---|
| `local_dirty` or `local_locked` | **fast** | someone is writing, measured |
| in WORKING, neither signal | **slow** | claimed; nobody knows |

**The speed is a fact, not a decoration.** Fast means *this is being
written to right now*; slow means *this is claimed and unobserved*. A
reader learns one rule, and both states are ones the board can defend.

This is what makes travel acceptable where it was refused before: it is
not claiming progress toward an end, it is reporting a **rate of
observed activity** — and where nothing is observed, it says so by moving
slowly rather than by moving convincingly.

**`motion-reduce` keeps the track and the dot and stops the travel.** The
dot rests at one end, still glowing, still in place. Both halves — the
rule this repo has now written four times, and the reason: removing the
element takes the marker along with the movement. Under reduced motion
the two speeds collapse into one appearance, and that is correct:
*speed* is the thing being removed, so it cannot be the only carrier.
The row's note already says which state it is in.

**`aria-hidden`.** The note carries the fact in words. A screen reader
must not hear it twice, and it must never hear a speed.

### The flash watches everything except the clocks

`watchedState` widens from `pr.state` to the row's whole visible state —
**minus values that change on their own.**

**The boundary is not a caveat, it is the feature.** Measured: the note
on a WORKING row reads *"last commit 1 min ago"*, and `ageMinutes` ticks
beneath it. Watching "everything visible" literally would flash a
completely idle row **once a minute**, because `1 min ago` becomes
`2 min ago`. After an hour at the board every row would have flashed
sixty times and the marker would mean nothing.

So the watched value is every **observed fact**, and no **derived
time**:

| Watched | Not watched |
|---|---|
| `pr` (state, number, draft) | `ageMinutes` |
| `local_dirty`, `local_locked` | `waitingDays` |
| `local_ahead` | the note's *"…ago"* phrasing |
| `state`, `group`, `wave` | countdowns |
| `stuck` | |

The distinction is available because the contract already keeps it: ages
are numbers derived from a timestamp and a clock; everything else is
something the scan or the host observed. **A fact changes because the
world changed; a clock changes because time passed**, and only the first
is news.

**A new commit therefore flashes**, which is the reported gap: the branch
tip moved, `ageMinutes` resets, and — importantly — the *note* changes
from *"last commit 18 min ago"* to *"last commit 1 min ago"*. That note
change is a clock, so the flash must come from the underlying fact (the
tip moved), not from the sentence. An implementation watching the note
string would flash every minute and appear to work.

**The first pulse flashes nothing**, and a row returning after absence
starts silent — the rules `status-column-earns-its-width` established and
that widening the watched value must not lose.

**Transitions into or out of `unknown` do not flash** — the rule
`green-never-outranks-unknown` adds for `pr.state`, and it applies to
every watched fact for the same reason: *I cannot say right now* is a
change in the observation, not in the world.

### The two markers stay distinguishable

Four marks already share a row. The track and the flash are the two this
plan touches, and they must not merge:

| Mark | Says | Lifetime |
|---|---|---|
| Travelling dot | *someone is here, at this pace* | while it holds |
| Whole-line flash | *something just changed* | ~3 s |

A row can carry both — an agent writing *and* having just pushed — and
then it carries both. No mark is implemented by modifying another.

### What this does not do

**No progress claim.** The dot travels back and forth. It never fills,
never completes, never arrives.

**No new data.** Every watched fact is already on the row, and the two
activity signals landed today.

**No third speed.** Two states the board can defend, and no gradient
keyed to commit freshness — a scale nobody can read (*was that four
minutes or forty?*) that changes continuously would be motion in place
of information.

## Branches

### Pace

- `feature/working-rows-show-their-pace` — the activity marker becomes a
  track with a travelling dot at two speeds; `motion-reduce` keeps it and
  stops the travel

### Change

- `feature/the-line-flashes-on-any-written-update` — `watchedState`
  widens to every observed fact and excludes derived time, so a new
  commit flashes and a ticking clock does not

Two waves, sequential. Both touch `AgentList.tsx`, and the second changes
a function the first renders beside. Pace first: it is the smaller
change and the one that was asked for first, and the flash sits on a row
whose marker has settled.

## Done when

- **A row with `local_dirty` or `local_locked` travels fast; a WORKING
  row with neither travels slow.** Assert both, and assert the two are
  distinguishable.
- **The dot never arrives.** Assert the animation returns to its start —
  a fix that fills or completes reintroduces the progress claim this
  repo refused twice.
- **`motion-reduce` keeps the track and the dot and stops the travel.**
  Both halves. Assert the marker is still present and the note still
  carries the state in words, since speed is gone.
- **A new commit flashes the line.** Assert the branch tip moving
  produces the whole-line mark — the reported gap, invisible today.
- **A ticking clock does NOT flash the line.** Assert an otherwise idle
  row across a minute boundary: `ageMinutes` 1 → 2 and the note's
  *"…ago"* both change, and neither is news. **The pairing that
  matters:** an implementation watching the row's rendered note passes
  every positive assertion above and flashes every row once a minute.
- **`waitingDays` does not flash**, for the same reason.
- **The first pulse flashes nothing**, and a row returning after absence
  starts silent.
- **Transitions into or out of `unknown` do not flash**, for every
  watched fact.
- **The travelling dot and the flash are distinguishable on one row.**
  Assert a row that is dirty *and* just changed shows both.
- **`[data-live-dot]`, `[data-stuck-cue]` and the stuck row are
  untouched.**
- `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`,
  `pnpm run validate` all pass.
- `pnpm build:board` run in the implementing worktree and the artifact
  committed — CI gates on no-diff.
- A changeset is present, with its `bumps:` block.

## Notes

The request was *highlight the whole line on every written update*, and
this plan implements that with one boundary: **values that change by
themselves are not updates.** Three of them are visible on a row —
`ageMinutes`, `waitingDays`, and the note's *"…ago"* phrasing — and
watching them would flash an idle row once a minute, which is the
fastest way to make a marker meaningless.

The distinction the board can make, and the reason this works: a fact
changes because the world changed; a clock changes because time passed.

Travel was refused twice in this repo, both times because it implies
progress toward an end that nothing measures. A dot that returns is the
form that does not: it reports a rate rather than a destination, which is
why it is acceptable here and a spinner still is not.
