# NOT STARTED says what each row is waiting for

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

Asked on 2026-08-17: *can NOT STARTED colour its statuses the way the
other sections mark theirs — eligible or blocked, so it is visible which
work is waiting and which needs the user?*

The need is real. The measurement sharpens both halves of it.

### NOT STARTED is four states wearing one face

Measured — six code paths reach `group: 'not-started'` in `fleet.ts`, and
three of them are the same state:

| Path | Note today | Waiting on |
|---|---|---|
| `verdict !== 'eligible'` | *blocked by an earlier wave* | **time** — clears itself |
| `planPhase === 'draft'` | *plan not approved yet — still in review* | **you** — approve it |
| otherwise | *eligible — nobody has taken it* | **a click** — dispatchable now |
| `state === 'deferred'`, with a PR | *PR #N …* | **you** — a decision was taken to shelve it |
| `state === 'deferred'`, no commits | *no commits* | **you** — same |
| `state === 'deferred'`, older commit | *last commit 3h ago* | **you** — same |

So four states, not six, and — more importantly — **not the two the
question assumed.**

### `eligible` versus `blocked` is the wrong axis

It is the fleet scan's vocabulary, so it is a natural way to ask. But it
splits the wrong way for a reader:

- A row **blocked by an earlier wave** needs nothing from anyone. Its
  predecessor merges, and it becomes eligible on the next pulse. There is
  no action, and there never will be one.
- A row whose **plan is still Draft** waits on a human indefinitely.
  Nothing in git will move it.

Under *eligible/blocked* those two are one colour, and they are the two
that most need separating: one resolves itself, the other resolves never.

The question a reader brings to this section is **"is there something for
me to do here?"** — so that is what the row answers.

### And `eligible` does not mean "will be dispatched automatically"

Worth recording because the question assumed otherwise: nothing on this
board dispatches by itself. `eligible` means **dispatchable** — a claim
nobody has taken — and it still needs a click or a command. The one
exception being built (`board-watches-for-stuck-branches`, wave 3) is an
artifact-only merge conflict, and it is granted precisely because its
correctness is provable without judgement.

A colour promising automatic dispatch would be the board asserting
something it does not do.

## Design

### Three answers to "what is this waiting for"

| Waiting on | Which rows | Reads as |
|---|---|---|
| **You** | plan still Draft; deferred work | *needs you* |
| **A click** | eligible, unclaimed | *ready to start* |
| **Time** | blocked by an earlier wave | *waiting its turn* |

Three, not four: **deferred joins Draft** because both wait on a person
with no clock running. They differ in *what* the person would do —
approve versus un-shelve — and the note already says which. The colour
answers the coarser question; the words answer the finer one.

### The note carries the meaning; the colour makes it visible at distance

The notes already say the right things — *blocked by an earlier wave*,
*plan not approved yet — still in review*, *eligible — nobody has taken
it*. They are precise, and they are invisible until read.

So the notes stay and the colour is added **beside** them, never instead.
This repo's rule is *carried as a symbol AND a word, never as colour
alone*, and the contract states it for `pr.state` already. A reader with
no colour perception loses nothing: the sentence is the same one that is
there today.

**Where the notes get sharpened, they get sharper — not shorter:**

- *eligible — nobody has taken it* is right and stays.
- *blocked by an earlier wave* gains what unblocks it, because the reader's
  next question is always *by which one*: **blocked by `<wave>`**.
- The three deferred notes keep reporting the branch's own facts — PR,
  commit age, no commits. `state === 'deferred'` is already carried
  *beside* the note rather than replacing it, and the comment in
  `fleet.ts` says why: an earlier version wrote the word `deferred` as
  the note and *"a branch started and then shelved read as never begun,
  with its age and its PR erased."* That mistake is not to be repeated by
  a colour either.

### Only one of the three is loud

**`needs you` is the only state that gets a strong colour.** The other
two are stated, not shouted:

- *ready to start* — the work is available, and taking it is optional;
  a colour that competes with `needs you` would make the section shout
  twice and mean once.
- *waiting its turn* — nothing to do, ever. It is the most common state
  in a multi-wave plan and the least actionable, so it is the quietest.
  A section where every row is coloured has coloured nothing.

Measured for scale: the pulse during this session's fleet held 43 rows
across the sections, with multi-wave plans routinely showing two blocked
rows for every eligible one.

### No animation here

`board-watches-for-stuck-branches` establishes that an animated cue marks
**an unanswered request** — something waiting on you that will keep
waiting. A Draft plan does qualify, and it is still not the same thing: a
stuck branch is an *interruption* to work in flight, while a Draft plan
is work that has not begun. The board would be interrupting the reader
about the ordinary state of a plan they wrote minutes ago.

The distinction to preserve: **motion is for things that went wrong**,
colour is for things that are simply so. Two vocabularies, and this is
the second one.

## Branches

### Colour

- `feature/not-started-says-what-it-waits-for` — the three waiting-states
  are derived from the existing notes and phase, rendered as colour beside
  the unchanged words; `blocked by an earlier wave` names the wave

## Done when

- **The three waiting-states are distinguishable**, and `needs you` is
  the only strong one. Assert all three render distinctly and that a
  section of only blocked rows is quiet.
- **A Draft-plan row and a blocked-by-wave row do NOT look alike.** The
  pairing that matters: an implementation keyed on the fleet's
  `eligible`/`blocked` verdict passes a "are they coloured?" assertion
  and puts these two — the pair most needing separation — in one bucket.
- **Deferred rows read as `needs you`**, and **keep their own note**: PR,
  commit age, or `no commits`. Assert the note is unchanged — an earlier
  version of this row wrote `deferred` as the note and erased the
  branch's age and PR, and a colour must not repeat it in another form.
- **The word is never removed.** Assert every coloured row still carries
  its sentence, and that the state is legible with colour ignored.
- **`blocked by an earlier wave` names the wave.**
- **Nothing animates in this section.** The pairing: reusing the stuck-cue
  from `board-watches-for-stuck-branches` passes every visibility
  assertion and turns an ordinary state into an interruption.
- **No row claims automatic dispatch.** Assert `eligible` reads as
  *ready to start*, not *starting* — nothing on this board dispatches
  itself.
- **The contract is unchanged.** The three states are derived from
  `note`, `state` and the plan phase the row already carries.
- `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`,
  `pnpm run validate` all pass.
- `pnpm build:board` run in the implementing worktree and the artifact
  committed — CI gates on no-diff.
- A changeset is present, with its `bumps:` block.

## Notes

The question proposed *eligible or blocked*. That is the fleet scan's
vocabulary and the natural way to ask, and it splits the wrong way for a
reader: it puts *blocked by an earlier wave* (clears itself, no action
possible) in the same bucket as *plan still in Draft* (waits on a human
forever). Those are the two states most worth telling apart, so the axis
became **what is this waiting for** instead.

It also assumed eligible work is dispatched automatically. It is not —
`eligible` means a claim nobody has taken, and starting it is still a
click. Recorded here so the colour is not later read as a promise.
