# The status column earns its width, and says when it changed

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

Reported on 2026-08-17, against the grid that had landed minutes earlier
(#175), with a screenshot of WAITING ON YOU:

| Phase | Plan | Branch | Status | Age |
|---|---|---|---|---|
| *(none)* | *(none)* | `feature/opus5-longhorizon-hardening` | `⑂57 conflicts` | `22d` |
| *(none)* | *(none)* | `changeset-release/main` | `⑂116 no checks` | `6m` |
| `Development` | `agent-rows-line-up` | `feature/card-shows-interrogation-rounds` | `⑂177 conflicts` | `5m` |

Three questions came with it: *where do we add the CI status, where does
watching information go, and can the status column have more space?*

The first answers itself, and that is worth recording rather than
building: **the CI status is already there.** `pr.state` landed in the
contract with #165 and gained its own cell with #175 — `conflicts` and
`no checks` in the screenshot are that field rendering. Nothing to add.

The other two are real, and they are different problems that happen to
share a column.

### The space is not missing; it is misallocated

Measured — `AgentList.tsx:192`, one exported constant, used in exactly
one place:

```
ROW_TRACKS = 'grid-cols-[6rem_10rem_1fr_9rem_2.5rem_1.25rem]'
              phase  plan  branch status age   menu
```

The branch column takes `1fr`. `1fr` does not mean *take what you need*;
it means **take everything left over**. So every pixel the window has
beyond the fixed tracks collects between the branch name and the status,
which is precisely the gap in the screenshot — a gap that *belongs to*
the branch column and is simply not drawn.

Meanwhile the status sits at `9rem` (144 px) and must hold a glyph, a
number, and a word: `⑂177 conflicts` fits, `⑂116 no checks` fits, and
anything wider does not. The branch names are already fully legible in
the screenshot — they do not need the reserve they are holding.

### A state cannot say when it started

The screenshot's own rows make this exact:

```
⑂57  conflicts   22d
⑂177 conflicts    5m
```

Identical status, and they mean opposite things. One has been conflicting
for three weeks and is a standing decision nobody has taken. The other
started conflicting minutes ago because `main` moved under it, and is a
thing to fix now.

The Age column is not the answer: it reports **the PR's age**, not the
state's. #57 is 22 days old *and* has been conflicting for most of them;
#177 is 5 minutes old and started conflicting almost immediately. Age
happens to separate these two rows and would not separate a
three-week-old PR that broke this morning.

**A status column can say what is true now. It cannot say what just
changed.** That requires knowing the previous value — which is the one
thing this board has deliberately never kept.

## Design

### The tracks, changed by one number

```
6rem  10rem  1fr  14rem  2.5rem  1.25rem
                  ↑ was 9rem
```

The branch keeps `1fr` and the status grows to a fixed `14rem`. This is
the conservative of the three shapes considered, and the reasons are
worth recording because the other two are tempting.

**`minmax(9rem, auto)` on the status** — sized to content — was rejected
because the column edge then moves between rows and between sections:
`no checks` and `conflicts` are different lengths, so the boundary would
wander, and *every row's status starts at the same x* is the property
#175 was built to establish. A wandering edge would give back at one
column what the grid just fixed at all of them.

**`max-content` on the branch, `1fr` on the status** — maximum status
space — was rejected for the same reason and more sharply: the branch
column would then size to the longest name *in that section*, so WAITING
ON YOU and WORKING would disagree about where the branch starts. That is
the original defect, reintroduced one column to the left.

A fixed `14rem` keeps every edge where it is and takes 80 px back from a
gap that displays nothing. The cost is honest: on a narrow-but-not-mobile
window the branch column loses those 80 px and elides sooner. Middle
elision (from #175) keeps both ends, and the full name stays in `title`.

**Below `sm` nothing changes.** `CARD_BELOW_PX = 640` and the row becomes
a stacked card there; tracks do not apply, so this is a wide-window
change only.

### A row that changes state lights up briefly

When a row's `pr.state` changes from one pulse to the next, the row
flashes and fades — a few hundred milliseconds, then gone.

**Why a flash rather than a lasting mark.** The question the reader has
is *did something just happen?*, and it is a question with a short
lifetime: once seen, it is answered. A lasting badge would accumulate —
after an hour at the board every row would carry one, and a mark every
row wears says nothing. The flash is spent by being seen, which matches
what it means.

**Why not a timestamp in the status cell.** It was the other candidate
and it answers a *different* question — *how long has this been true?* —
which is genuinely useful and genuinely separate. Folding both into one
cell would give one label two meanings, which is the defect this board
keeps removing. It stays available as later work; it is not this.

**The memory is the previous pulse, and nothing more.** The board holds
`fleet` in one `useState` (`App.tsx:82`), replaced whole every 4 s. This
adds a ref holding the prior `pr.state` per row key — rows are already
identified as `${repo}/${branch}` (`AgentList.tsx:1505`), which is what
makes a prior value attributable to a row at all. Nothing is persisted,
nothing is written to disk, and the board still asserts nothing it did
not read: it reports *the value changed between two things I read*, which
is a fact about its own observations.

**Absent is not a change.** The first pulse after a page load, a board
restart, or a reconnect has no prior value for any row — and *unknown →
conflicts* is not a transition, it is a first sighting. Treating it as
one would flash every row on every restart, which is both wrong and the
loudest possible way to be wrong. The rule is the one this repo has
applied five times over: **absent is unknown, never a value.** A row with
no prior state records the current one silently and flashes nothing.

The same applies in reverse: a row that disappears and returns (a branch
deleted and recreated, a section collapsed and reopened) has no prior
value at its return, and starts silent.

**A row whose state did not change does not flash**, however much else
about it moved — new commits, a changed note, a different group. This is
about `pr.state` alone.

**`motion-reduce` keeps the marker and stops the animation.** The rule
`working-rows-show-motion` settled and #176 reapplied: under
`prefers-reduced-motion` the row still marks itself changed — a static
tint that clears on the next pulse — rather than losing the information
along with the movement.

**It is not announced.** The flash is `aria-hidden` decoration over a
cell whose text already changed; a screen reader reaches the new value by
reading the row. An `aria-live` region firing on every CI transition
across every row would be an interruption, not an aid.

### What this does not do

**No desktop notifications.** Considered and deferred: it needs a
permission prompt, a decline path, and a decision about what happens when
the tab is closed — and it is the first thing this board would send
outward rather than display. The reported need is *see it while looking
at the board*, which the flash meets.

**No watching of anything but open PRs already on the board.** No new
data source, no new endpoint, no polling change. The board already reads
this every 4 s; the whole change is that it now remembers one pulse.

## Branches

### Width

- `feature/status-column-earns-its-width` — `ROW_TRACKS` gives the status
  column 14rem; assertions that every edge stays put and the card below
  640px is unaffected

### Change

- `feature/row-flashes-when-its-state-changes` — the row marks a
  `pr.state` transition between pulses, silent on first sighting,
  `motion-reduce`-safe, `aria-hidden`

Two waves, sequential, and the dependency is real rather than tidy: both
touch `AgentList.tsx`, and the second adds a visual layer to the same row
the first re-sizes. This session paid four manual conflict resolutions in
one hour for two branches meeting in the same objects — every one a union
with no genuine disagreement, and every one still a rebase and a rebuild.

Width goes first because it is the smaller change and the one that was
asked for directly; the flash sits on top of a row whose columns have
settled.

## Done when

- **The status column is 14rem and the branch column keeps `1fr`.**
  Assert the constant, and assert that a row with a long branch name
  elides rather than pushing the status cell.
- **Every row's status cell starts at the same x**, in every section,
  with and without a phase, and whether or not the plan name sits in the
  group heading. The pairing that matters: `minmax`/`max-content` shapes
  pass a "the status got wider" assertion and break this one.
- **Below 640px nothing changes.** Assert the card layout at 375px is
  identical to before — tracks do not apply there.
- **A row whose `pr.state` changes between pulses flashes.** Assert a
  transition (`pending` → `failing`) produces the marker.
- **A row whose state did NOT change does not flash**, even when other
  fields moved. Assert a pulse that changes the note and the commit count
  but not `pr.state`.
- **The FIRST pulse flashes nothing.** Assert a fresh mount with rows
  already carrying states — the case that fires on every page load and
  every board restart, and the one a naive implementation gets wrong in
  the loudest possible way.
- **A row returning after absence does not flash.** Assert a row removed
  from one pulse and present in the next with the same state as before it
  left: it has no prior value at its return, so it starts silent.
- **`motion-reduce` keeps the marker and stops the animation.** Both
  halves — a fix that hides the marker under `motion-reduce` passes a
  motion-only assertion and loses the information.
- **The flash is `aria-hidden`** and no live region announces it.
- **The flash clears itself.** Assert it is gone after its duration
  without another pulse — a marker that needs the next pulse to clear
  would stay lit on a board that lost its server.
- **Nothing is persisted.** Assert no disk write and no contract change:
  the memory is one prior value in the client, and the server is
  untouched.
- `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`,
  `pnpm run validate` all pass.
- `pnpm build:board` run in the implementing worktree and the artifact
  committed — CI gates on no-diff.
- A changeset is present, with its `bumps:` block.

## Notes

The CI status needed no work: it was asked for and already existed,
shipped by #165 (the contract field) and #175 (the cell). Recording that
here so the question is not re-opened.

The timestamp variant — `conflicts (5m)`, saying how long a state has
held — was considered against the flash and deliberately kept separate
rather than merged into it. It answers *how long has this been true?*
where the flash answers *did something just happen?*. Both are useful;
one cell holding both would be one label with two meanings.
