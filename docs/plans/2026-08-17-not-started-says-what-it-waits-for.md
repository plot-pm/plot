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

### The state travels as a field, not as a sentence

**Measured, and it changes how this is built.** The row derives its
startability from a string comparison today:

```ts
export function isStartable(row: AgentRow): boolean {
  return row.group === 'not-started' && row.state === 'open'
      && row.note === ELIGIBLE_NOTE;
}
```

That is the pattern #175 removed from the PR cell — *"a parser for a
format nobody declared"*, which silently drops its answer the moment the
server's wording drifts. Deriving a colour the same way would be worse,
because this plan **sharpens the notes** in the same breath: a row
matching on `blocked by an earlier wave` breaks the moment that sentence
gains the wave's name.

So the server computes the waiting-state and sends it as a field. The
note stays prose for humans; the colour reads a value. This follows
`pr.state` (#165) and `stuck` (#183), both of which replaced exactly this
shape.

**The row also does not carry the wave verdict.** Measured: `verdict`
sits on the *wave* (`schema.ts:664`); the row carries only `wave`, the
name. So the row cannot see *that* it is blocked, let alone by what —
another reason the state has to be computed server-side, where both are
in hand.

**And the blocking wave travels with it.** The server knows which earlier
wave is incomplete when it builds the row, so it sends that name and the
row reads *blocked by `Truth`* rather than *blocked by an earlier wave*.
*By which one?* is the reader's unavoidable next question, and it costs
one string to answer.

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

### A Draft plan colours only its FIRST wave

**Measured problem the first draft missed:** a Draft plan holds every one
of its branches, and this session's plans routinely have three or four
waves. Colouring each row would put four loud rows on the board for **one**
pending approval — and the later three would still be blocked the instant
after it is granted, because their predecessors have not run.

So only the rows of the plan's **first wave** wear `needs you`. They are
the ones that would actually move on the click; the rest are waiting on
their predecessors, which is *waiting on time* and reads as such.

This keeps the colour's promise exact: **it marks rows your action would
release**, not rows that share a plan with them. A four-wave plan
therefore shows one loud wave and three quiet ones, which is also the
truth about what the approval buys.

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

### Still colour, and motion once it has waited too long

`board-watches-for-stuck-branches` establishes that an animated cue marks
**an unanswered request** — something waiting on you that will keep
waiting. A fresh Draft plan is not that: it is the ordinary state of a
plan written minutes ago, and animating it would interrupt the reader
about their own work in progress.

**But a Draft that has sat for days is an incident — just a slow one.**
The same plan waiting on the same person, with nothing in git able to
move it, is precisely the *unanswered request* the stuck cue exists for.
So the marker escalates from colour to motion once the wait is long
enough to be a problem rather than a phase.

**The threshold is not guessed, and that constraint is load-bearing.**
This plan rejected a guessed number elsewhere, and the same rule applies
here: it must come from something the board already measures. The row
carries the age it needs — a plan approved in minutes and one untouched
for a week are distinguishable without inventing a constant.

**Measured before approval, and the history does not support a
threshold.** Every plan in this repo carrying an `Approved:` record — 31
of them — was approved on the day it was drafted, bar one that took a
single day:

```
30 plans   0 days
 1 plan    1 day
```

So the state this escalation would mark **has never occurred here**.
Choosing a number would mean inventing the first case it is meant to
measure, and a wrong threshold trains the reader to ignore the cue, which
costs more than not having it.

**The fallback this plan set for itself therefore applies: ship the
colour alone.** The escalation stays specified above rather than deleted,
because the reasoning holds and the day a Draft does sit for a week the
threshold can be taken from that observation instead of from a guess.
Until then, `needs you` is a colour, and nothing in this section moves.

The distinction that survives: **colour says what a row is; motion says
it has been waiting on you too long.** The first is a property, the
second is an accusation, and only the second earns the scarce channel.

## Branches

### Colour

- `feature/not-started-says-what-it-waits-for` — the server computes the
  waiting-state and the blocking wave's name onto the row; the board
  renders them as colour beside the words and colours only a Draft plan's
  first wave. No animation: the repo's history shows no long-waiting
  Draft to calibrate one against

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
- **The state is a FIELD, not a string match.** Assert the colour
  survives a reworded note — and that no comparison against
  `ELIGIBLE_NOTE` or `DRAFT_PLAN_NOTE` decides it. The pairing that
  matters: matching sentences passes every appearance assertion and
  breaks silently the first time the wording changes, which this plan
  does on purpose.
- **`blocked by <wave>` names the blocking wave.** Assert the name is the
  wave that is actually incomplete, not merely the previous one in the
  list.
- **A Draft plan colours only its FIRST wave.** Assert a four-wave Draft
  plan shows one loud wave and three quiet ones. The pairing: colouring
  every row of the plan passes a "does a Draft plan show needs-you?"
  assertion and puts four loud rows on the board for one approval.
- **Nothing in this section animates.** Measured before approval: 31
  plans carry an `Approved:` record, 30 approved the same day and one
  after a single day, so the long-waiting Draft this escalation would
  mark has never occurred in this repo. The plan's own fallback applies —
  the colour ships alone. Assert no `animate-*` anywhere in the section.
- `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`,
  `pnpm run validate` all pass.
- `pnpm build:board` run in the implementing worktree and the artifact
  committed — CI gates on no-diff.
- A changeset is present, with its `bumps:` block.

## Notes

The contract gains one field — the waiting-state, computed server-side,
with the blocking wave's name beside it. That is a deliberate reversal of
this plan's first draft, which proposed deriving the three states from
the notes. Measured against `isStartable`, which does exactly that today
via `row.note === ELIGIBLE_NOTE`, the derivation is the shape #175
removed from the PR cell — and it would have broken on the very
note-sharpening this plan performs.

The question proposed *eligible or blocked*. That is the fleet scan's
vocabulary and the natural way to ask, and it splits the wrong way for a
reader: it puts *blocked by an earlier wave* (clears itself, no action
possible) in the same bucket as *plan still in Draft* (waits on a human
forever). Those are the two states most worth telling apart, so the axis
became **what is this waiting for** instead.

It also assumed eligible work is dispatched automatically. It is not —
`eligible` means a claim nobody has taken, and starting it is still a
click. Recorded here so the colour is not later read as a promise.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {"q": "isStartable matches row.note === ELIGIBLE_NOTE — derive the colour the same way?", "a": "No — a field on the row; the plan sharpens the very notes a match would depend on", "category": "technical"},
    {"q": "The row carries `wave` but not `verdict` — how does it know it is blocked?", "a": "Server-side; and it sends the blocking wave's NAME so the row can say which", "category": "technical"},
    {"q": "A 4-wave Draft plan would colour four rows for ONE approval?", "a": "Only the first wave — the rows the click would actually release", "category": "ux"},
    {"q": "No animation here, when #181 animates a stuck branch?", "a": "Escalate: colour while fresh, motion once it has waited too long; threshold measured, never guessed", "category": "ux"}
  ],
  "categoriesCovered": {
    "technical": {"stack": true, "architecture": true, "implementation": true},
    "domain": {"rules": true},
    "ux": {"happyPath": true, "edgeCases": true, "accessibility": true},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
