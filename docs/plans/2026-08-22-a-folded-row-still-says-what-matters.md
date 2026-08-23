# A folded row still says what matters

> WORKING spends four lines and ~150px on each of ten branches. The two levels of folding already exist — what a folded head says does not yet make folding worth doing.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** <!-- optional -->
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A folded plan or wave now says how many branches it holds and what needs attention inside it, so folding hides repetition instead of hiding facts.

<!-- Board impact: board-only. packages/board/src/app/components/AgentList.tsx
     (the fold heads) and src/app/lib/tuple-row.ts (splitBranch). Rebuild the artifact. -->

## Motivation

Measured from the WORKING section, 2026-08-22: **10 branches, ~1500px**, four
lines each — wave label, plan link, note, and often a warning. A reader looking
for *what needs me* scrolls past nine rows to find the tenth.

**The two collapse levels asked for already exist.** `data-wave-toggle` folds a
plan (`AgentList.tsx:4427`); `data-wave-branch-toggle` folds a wave (5203). The
mechanism is not the gap.

**The gap is what a folded head says.** Today a folded plan head shows the plan
name and a bare count — `every-section-has-one-subject (3)`. Three of what? In
what state? A reader who folds loses the answer and unfolds again, so folding
costs a click and returns nothing. That is why the section is rendered open.

### What the fold must not hide

The same screenshot carries **`claimed twice — claimed by 2 plans:
approval-hands-the-work-to-agents, every-section-has-one-subject`** on PR #327.
That is a real estate defect (both plans name
`feature/the-registry-knows-which-agents-live`, and one records it as `Started:`
twice), and the board surfacing it is the board working.

**A fold that hides a conflict is worse than no fold.** This is the constraint
the whole design turns on: folding may hide *repetition*, never *exceptions*.

## Design

### The target shape already exists — with the wrong content in it

The one-line folded plan row is **already built and already rendering**.
Measured from the same board:

```
▶  PLAN  a-dispatch-hands-…      (3)   Discovery   ⋯
▶  PLAN  a-mock-row-shows-…      (2)   Discovery   ⋯
▶  PLAN  a-startable-wave-says-so      Discovery   ⋯
▶  PLAN  a-wave-is-one-bra…      (3)   Discovery   ⋯
```

Ten rows, one line each, folded. **This is the density being asked for**, and it
is not a thing to build — it is a thing to fill.

What is wrong is the information content. `Discovery` appears on **nine of ten
rows**: a value identical across the set carries no bits, and it occupies the
row's whole status slot. The count `(3)` carries a little. What a reader wants
from a folded row — *is anyone working in there, and does anything need me* —
appears nowhere.

The WORKING screenshot has the opposite failure: every runtime fact (worker
state, PR, note, `claimed twice`) at four lines and ~150px per branch.

**The two are one design at two densities.** The target is the folded row's
shape carrying the open row's facts.

### What a folded head carries

A folded head answers the question its children would have answered, in one
line — replacing the constant phase word, not sitting beside it:

```
▶  PLAN  every-section-has-one-subject   3 branches · 2 waiting on you · 1 claimed twice
▶  PLAN  a-dispatch-hands-over-a-brief   3 branches · 1 working 12m
▶  PLAN  a-startable-wave-says-so        nothing started
```

Three parts, and each earns its place:

- **the count**, which the head already has
- **the tally by attention** — how many of the children need a person. This is
  the fact folding currently destroys.
- **the exceptions, named** — `claimed twice`, `conflicts`, `stalled`. Never a
  count alone: a reader must be able to decide whether to unfold without
  unfolding.

Where a fold holds nothing exceptional, the third part is absent — not `0
problems`, which teaches a reader to stop reading the line.

### The runtime half, and where it comes from

*"Something like this, but with runtime information about the work currently
happening"* — the fold should say what is **live**, not only what is counted.

The board already has this. `registry.ts` resolves an `AgentState` per
dispatched agent — `running`, `waiting`, `stalled`, `finished`, `unknown` —
against a real `kill -0`, batched once per pulse. WORKING renders it today
(`worker waiting on you: TOD…`, `uncommitted work in a local worktree`). None of
it survives folding.

So a folded head names the live states inside it:

| inside the fold | the head says |
|---|---|
| an agent `running` | `1 working 12m` |
| an agent `waiting` (a `PLOT-BLOCKED:` marker) | `1 waiting on you` |
| an agent `stalled` | `1 stalled` — and the fold **renders open** |
| no agent at all | `nothing started` |

**`stalled` is the case that justifies the runtime half.** Measured today: a
dispatched worker exited 0 with no PR and 283 lines of good work uncommitted,
because it ended its turn awaiting a notification that could not arrive. Exit
code 0 — indistinguishable from success from outside the worktree. A fold that
says `3 branches` over that is actively misleading; a fold that says `1 stalled`
is the whole point of the board.

**The age is the freshest child's, not the fold's own.** A plan folded over an
agent that moved 12 minutes ago is 12 minutes old, whatever the plan file's
mtime says. Deriving it from anything else reproduces the defect
`the-pulse-measures-progress-not-elapsed-time` already fixed once.

**`nameList` already does this shape** (`AgentList.tsx:1069`): at most three
names, then `and N more`. Reuse it rather than inventing a second summary
grammar; the argument it was written under — *"a banner that grows without bound
stops being a banner"* — is the same argument here.

### Which level folds by default

**Plans fold; waves within an unfolded plan do not.** A plan is the unit a
reader chooses to care about; a wave is how that plan is sliced, which matters
only once the plan does.

**Exception, and it is the point of the whole plan: a fold containing anything
exceptional renders unfolded.** A `claimed twice` or a `stalled` worker is not
something a reader should have to go looking for. The default is *quiet things
fold, loud things do not*.

### The single-wave case

A plan with one wave should render as **one row**, not a plan head above a
lone wave head above a branch. `the-plan-is-the-wave` (approved, eligible)
already covers exactly this — *"Plans with a single WAVE don't have a WAVE. The
plan is the WAVE."* This plan must not re-implement it; where the two meet, that
plan owns the single-wave collapse and this one owns what a MULTI-child fold
says.

### A defect this exposes, and it is not cosmetic

The branch labels in the screenshot read `f…s-start-work`, `b…s-its-rounds`,
`de-challenged`, `fnt-needs-you`. `splitBranch` keeps a fixed-width **tail** and
clips the **head** — but the head is where `feature/`, `bug/`, `infra/` live, so
the elision destroys the branch's KIND and keeps its middle. `de-challenged` and
`fnt-needs-you` are not readable as branch names at all.

The rationale for tail-keeping is sound and stated: six branches here share
twenty-four characters of prefix, so end-truncation renders them identically.
But the current split is the other extreme. **The prefix is a category, not
noise**: `feature/…` and `bug/…` are what a reader scans for.

This wants the prefix kept, the middle elided, and the tail kept —
`feature/…start-work` rather than `f…s-start-work`. Folded rows make it worse
(less width per row), which is why it belongs here rather than being deferred.

### Open Questions

- [ ] Does the attention tally come from `waitingOn`, or from the row's own
      `group`? These disagree — the plan `a-plan-moves-through-the-sections`
      exists because `waitingOn` was unreachable for whole classes of row.
      Resolve by reading what is true after #325, not before it.
- [ ] Should a fold's state persist per viewer (`localStorage`)? Probably yes,
      but it is view state and this board's stated rule is *view state in the
      URL, convenience in localStorage*. Decide against that rule, not ad hoc.

## Done when

- A folded plan head names its branch count, its attention tally, and any
  exception by name — asserted on rendered text, not on a data attribute.
- The **constant phase word is gone** from the folded row, or has yielded its
  slot. Asserted directly, because an implementation that appends the tally
  beside `Discovery` passes every other test here and buys no width — which is
  the actual complaint.
- A folded head names the live agent states inside it (`working`, `waiting on
  you`, `stalled`), sourced from the registry rather than re-derived. A fold
  over an agent that moved 12 minutes ago reads 12 minutes, not the plan's age.
- A fold containing a **stalled** agent renders open and says `stalled` — the
  exit-0-with-uncommitted-work case measured 2026-08-22, which is invisible from
  outside the worktree and is the reason the runtime half exists.
- A fold holding a `claimed twice`, a conflict, or a stalled worker **renders
  unfolded**. Asserted directly: this is the property the plan exists for, and
  an implementation that folds everything uniformly passes every other test here.
- A fold holding nothing exceptional shows no exception clause — no `0 problems`.
- `splitBranch` keeps the branch's prefix: `feature/x` elides to something a
  reader can still identify as `feature/…`, asserted on the rendered string.
- **The density claim is a measured ratio, not a word.** With the ten-branch
  fixture below, the folded render is at most **40%** of the unfolded height —
  and the 40 is derived rather than chosen: two folded heads against ten rows.
  Assert the ratio, so it fails when folding stops saving space; "materially
  less" is a claim nothing can fail.

### Fixtures are hand-built, because these states are rare

Every assertion here needs a board state the live estate does not hold. Measured
2026-08-23: **WORKING is empty (0 rows)**, there are **0 stalled workers**, and
only 2 rows carry `claimedBy`. The screenshot this plan was written from showed
ten agents running; that moment is gone and will not recur on demand.

So the pulses are **constructed in the test**, as literals:

```ts
const busy = fleet([
  row({ group: 'working', worker: 'running', wave: 'Folded', ... }),
  ...nine more
]);
```

**The cost is stated rather than hidden:** a hand-built fixture is what someone
believes the board produces, not what it produced. Two guards against that:

- every value in the fixture must be one the **live payload has actually
  carried** — checked against `/api/fleet`, never invented
- the fixture is parsed by the **schema**, so one that drifts from the contract
  fails rather than testing a board that cannot exist

A captured pulse was considered and rejected for the density claim specifically:
it needs a moment when ten agents are running, and waiting for one makes the test
unwritable today.
- `pnpm run test:board` green; artifact rebuilt and committed.

## Branches

### Readable

- `bug/the-elision-keeps-the-prefix` — `splitBranch` keeps the branch's kind, elides the middle, keeps the tail. Tests: a feature-prefixed branch still reads as one after elision at every width; two branches sharing a 24-character prefix still render distinguishably; a short name is untouched

### Folded

- `feature/a-folded-head-carries-its-tally` — a folded plan head names count, attention tally and named exceptions, reusing `nameList`, in the slot the constant phase word occupies today. Tests: a three-branch fold names three; an exception is named rather than counted; a clean fold shows no exception clause; the tally does not merely sit beside `Discovery`
- `feature/a-folded-head-says-what-is-live` — the head names the registry's agent states inside it, with the age taken from the freshest child. Tests: a running agent reads `working 12m`; a `PLOT-BLOCKED` marker reads `waiting on you`; a fold with no agent reads `nothing started`; the age is the child's, not the plan's
- `feature/the-loud-things-stay-open` — folds default closed, except any fold containing an exception. Tests: a quiet plan folds; a plan holding `claimed twice` renders open; a stalled worker renders open; the default is not "all open" and not "all closed"

## Notes

Asked as *"collapse this information but still show the most important — two
level collapsing? waves on a single row? plans on a single row?"* The
investigation found both levels already built (`data-wave-toggle`,
`data-wave-branch-toggle`), so the answer is not a new mechanism but a folded
head worth reading.

The single-wave-is-the-plan case belongs to `the-plan-is-the-wave`, already
approved and eligible — deliberately not duplicated here.

The `claimed twice` visible in the same screenshot is a real estate defect, not
a rendering one: `approval-hands-the-work-to-agents` and
`every-section-has-one-subject` both name
`feature/the-registry-knows-which-agents-live`, and the former records it as
`Started:` twice. It needs fixing in the plans, separately from this work — and
it is the reason the fold's exception rule is a hard requirement rather than a
nicety.
