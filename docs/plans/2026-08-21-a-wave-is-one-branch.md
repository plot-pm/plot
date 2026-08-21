# A wave is one branch, and an unsliced plan can be repaired

> The board can now SEE an invalid wave — `unsliced-wave`, five branches under
> `opus5-longhorizon-hardening :: Implementation`, blocked 26 days. It cannot fix
> one, and this plan is why it cannot yet: **slicing needs names, and naming is
> judgement.**

## Status

- **Phase:** Draft
- **Type:** feature
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Assignee:** jwloka

## Problem

### The model, and the one shape that violates it

Settled with the operator 2026-08-21:

    plan  ──sliced into──▶  * wave  ──carried out in──▶  1 branch / 1 worktree

A tracer or spike produces a **refined plan**; that plan is sliced into waves;
each wave is carried out in exactly one branch. A wave is therefore the unit of
**ordering** and a branch the unit of **work**, and the two are one-to-one.

Measured over `last-pulse.json` — 35 plans, 57 waves:

| branches in the wave | waves |
|---|---|
| 1 | **49** |
| 2 | 4 |
| 3 | 1 |
| 4 | 1 |
| 5 | 2 |

**Seven of the eight multi-branch waves are already `complete`.** They shipped
before the model was stated, which is why this is a repair rather than a
migration: the estate's only live violation is one wave.

### The live violation is the failure a tracer exists to prevent

`opus5-longhorizon-hardening` has two waves:

    ### Tracer
    - feature/opus5-hardening-ralph-bounds          → PR #49, green, unmerged

    ### Implementation
    - feature/opus5-hardening-challenge-budget      → PR #51, draft
    - feature/opus5-hardening-deliver-gates         → PR #52, draft
    - docs/opus5-hardening-invariants               → PR #53, draft, conflicts
    - feature/opus5-hardening-approve-tracer        → PR #54, draft
    - docs/opus5-hardening-model-provenance         → PR #55, draft, conflicts

The tracer is green and unmerged. Its whole purpose — `tracer-bullets` Step 4,
*"if validating a design, refine the plan"* — is to inform how the rest is
sliced, and the rest was never sliced. Five branches were dispatched in parallel
26 days ago and all five are still draft, three with conflicts.

So the defect the board now names is not cosmetic: it is the shape a plan takes
when its spike's lesson was never applied.

### Why the board cannot repair it

Every write the board performs is one of exactly two things, and
`board-writes-wrap-scripts-or-are-licensed-repairs` states there is no third:

1. **wraps an existing plot script** — `/api/approve` runs `plot-approve.sh`;
2. **a licensed deterministic repair** — `plot-resolve-artifact.sh`, the ONE
   automatic write, *"licensed by three verified properties … precisely because
   judgement's absence is the permission."*

Splitting `Implementation` into five waves requires **naming** five waves. That
is a semantic act: `Gated`, `Marked`, `Fitted` are words a person chose for what
each slice is *about*. Route 2 is therefore closed — judgement is present, so the
permission is absent — and route 1 is closed because no script exists to wrap.

The third sanctioned path is the one `/api/idea` already uses: **spawn a Plot
agent**. That is what this plan builds.

## Design

### A new spoke command, `/plot-reslice`

The judgement is *"what is each of these branches about, and in what order must
they land?"* — which is plan interrogation, the thing `challenge-the-plan` and
`/plot-idea` already do. So the shape is a spoke command that:

1. **reads** the plan's `## Branches` section and the wave holding several;
2. **reads the branches themselves** — their diffs, their PRs, their conflicts —
   because the slice names should describe what the work IS, not restate the
   branch names;
3. **proposes** one wave per branch, in a dependency order it argues for;
4. **asks**, because the order is the part a human must confirm: a wrong order
   blocks work that could have run, and a missing dependency lets two agents
   collide;
5. **rewrites** the plan file's `## Branches` section and nothing else.

Its `PLOT-UNASKED` shape matters — every Plot skill declares one, and a test
sweeps all skills for it. Unattended, `/plot-reslice` must **stop**: the order is
exactly the judgement it cannot make alone.

### What it must not do

- **Not rename branches.** They exist, they have PRs, and their names are already
  in `## Branches`. Only the `###` headings above them change.
- **Not reorder work that has landed.** A `complete` wave is history; seven of
  the eight violations are complete and must be left alone.
- **Not merge or dispatch.** The repair produces a sliced plan; `/plot-dispatch`
  then does what it always does, one worktree per branch — which now means one
  per wave, as the model says.

### The board's part

A row already says `wave not sliced` and names the entangled branches. It gains
one menu item — *Slice this wave* — which spawns `/plot-reslice` the way
`CreatePlanButton` spawns `/plot-idea`: same capability flag, same armed confirm,
same refusal-with-a-reason where the server will not act.

**Nothing about the detection changes.** `stuckState`'s `unsliced-wave` arm and
`isSpikeWave` landed already and are not revisited here.

## Branches

### Sliced
- `feature/plot-reslice-proposes-one-wave-per-branch` — a new spoke command reads a plan with a multi-branch wave, reads those branches' diffs and PRs, and proposes one named wave each in an argued order; it asks before writing and declares `PLOT-UNASKED: <question> — stopped` unattended, because the order is the judgement it cannot make alone. Tests: a plan with a 5-branch wave yields 5 `###` headings and 5 branch lines, one per branch; branch NAMES are unchanged; a `complete` multi-branch wave is left untouched; the rest of the plan file is byte-identical; the skill declares an unattended shape and the all-skills sweep passes; no branch is dispatched and no PR is touched.

### Offered
- `feature/the-board-offers-a-reslice` — the `unsliced-wave` row gains one menu item that spawns `/plot-reslice`, wrapping the agent the way `/api/idea` wraps `/plot-idea`. Tests: the item appears only on an `unsliced-wave` row; it is absent where the server would refuse and NAMES the refusal on the control; the click spawns the command and writes nothing itself; a `complete` wave offers nothing; the route refuses a non-localhost binding, like every other spawn.

## Notes

The sequencing here is the point. The board learned to **see** this shape in the
same session it was defined, and stopping there was deliberate: a repair that
invents wave names would be the board making a plan decision, which is the one
thing `board-writes-wrap-scripts-or-are-licensed-repairs` exists to prevent.

Worth recording that the model corrected an error of mine rather than filling a
gap. I read `CLAUDE.md`'s *"one worktree per eligible branch"* and concluded a
wave may hold several — the dispatch mechanism, mistaken for the modelling rule.
The operator's statement made them one: a wave holds one branch, so per-branch and
per-wave dispatch are the same sentence. The 49-of-57 measurement was sitting in
my own notes from earlier the same evening, describing the rule I had just argued
against.
