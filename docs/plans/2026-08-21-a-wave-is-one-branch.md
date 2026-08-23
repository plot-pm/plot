# A wave is one branch, and an unsliced plan can be repaired

> The board can now SEE an invalid wave — `unsliced-wave`, five branches under
> `opus5-longhorizon-hardening :: Implementation`, blocked 26 days. It cannot fix
> one, and this plan is why it cannot yet: **slicing needs names, and naming is
> judgement.**

## Status

- **Phase:** Approved
- **Type:** feature
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-23, Jan Wloka, in-session
- **Assignee:** jwloka
- **Started:** 2026-08-23, Jan Wloka, `feature/plot-reslice-proposes-one-wave-per-branch`
- **Started:** 2026-08-23, Jan Wloka, `feature/reconcile-counts-unsliced-waves`

## Approval

- **Assignee:** Jan Wloka

## Changelog

- A wave holds exactly one branch, and the board can say when one does not:
  an unsliced wave is named as invalid rather than sitting blocked without a
  reason.
- An unsliced wave can be repaired from the board, with the naming left to a
  person — slicing needs names, and naming is judgement.

## Problem

### The model, and the one shape that violates it

Settled with the operator 2026-08-21:

    plan  ──sliced into──▶  * wave  ──carried out in──▶  1 branch / 1 worktree

A tracer or spike produces a **refined plan**; that plan is sliced into waves;
each wave is carried out in exactly one branch. A wave is therefore the unit of
**ordering** and a branch the unit of **work**, and the two are one-to-one.

Re-measured 2026-08-22 with `plot-plan-meta.sh` over every plan file — 84
plans, 157 waves:

| branches in the wave | waves |
|---|---|
| 1 | **137** |
| 2 | 13 |
| 3 | 4 |
| 4 | 1 |
| 5 | 1 |
| 6 | 1 |

**Eighteen of the twenty multi-branch waves are Released.** They shipped before
the model was stated, which is why this is a repair rather than a migration.

**Two are live, and only one needs slicing.** `opus5-longhorizon-hardening ::
Implementation` holds five unmerged branches — the case below. The other,
`waiting-on-you-says-what-kind-of-waiting :: Shaped`, holds two branches that
are **both merged** (#287, #288): slicing a wave whose work has landed
re-orders nothing and rewrites history to no reader's benefit.

So the rule binds **waves with unlanded work**. A wave whose branches have all
merged is a record of how something shipped, not an instruction about what may
start — and the ordering the rule protects has already happened there.

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

### Scope: slice the wave, never do the work in it

The subject is `opus5-longhorizon-hardening :: Implementation` — five branches
under one wave, blocked 26 days. **That plan is out of the 2.9.0 sprint**, and
this one does not pull it in.

The distinction, because it is easy to lose:

| | in scope |
|---|---|
| splitting `### Implementation` into five waves in the plan file | **yes** — a plan-file edit |
| the six branches' actual work | **no** — that is `opus5-longhorizon-hardening`'s |

**Why the slice alone is worth doing:** an unsliced wave has no single verdict —
five branches in one wave means the wave is neither complete nor clearly startable
— so *a wave has one section* is **undefined** over it. The sprint's rules cannot
hold over a wave the model cannot describe. Slicing gives it a well-defined
verdict; whether anyone builds the branches is a separate question with a separate
answer.

**Deferring the branches was considered and rejected.** Marking them
`<!-- deferred: -->` would exempt them from the merge gate — measured, a deferred
branch is exempt, which is how an Endgame plan can hold 6 merged and 3 deferred —
and the wave would complete. But that claims work is *done* which is merely
*unstarted*, and the board would report a finished wave over five unbuilt
branches. **A verdict earned by annotation rather than by merging is the kind of
false completion this whole release is about removing.**

Five blocked waves instead of one blocked wave is the honest outcome, and it is
what the model can describe.



### The rule now has a home, and it is the manifesto

Until 2026-08-21 this plan argued a rule that the design authority contradicted.
`MANIFESTO.md` defined a wave as *"branches grouped under a `### ` subheading …
may run concurrently"* — a wave as a **group**, with parallelism living inside
it. That paragraph now reads *exactly one branch*, and carries the correction
note and the 49-of-57 measurement.

That changes what this plan is. It is no longer proposing a rule; it is
implementing one that the manifesto states — which is the order the repo's own
rule asks for, since a plan is not the place a design decision is made.

**And it moves the detection question in.** With the rule stated, a `###`
heading carrying two branch lines is a defect the estate should *report*, not a
shape a reader has to notice. The plan format is unchanged — one heading, one or
more branch lines is still what the file can express — so nothing in the parser
or the board's contract moves. What has to exist is a check, and the repo's own
`plot-reconcile-scan.sh` is where drift of this kind is already reported.

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
- `feature/plot-reslice-proposes-one-wave-per-branch` — a new spoke command reads a plan with a multi-branch wave, reads those branches' diffs and PRs, and proposes one named wave each in an argued order; it asks before writing and declares `PLOT-UNASKED: <question> — stopped` unattended, because the order is the judgement it cannot make alone. Tests: a plan with a 5-branch wave yields 5 `###` headings and 5 branch lines, one per branch; branch NAMES are unchanged; a `complete` multi-branch wave is left untouched; the rest of the plan file is byte-identical; the skill declares an unattended shape and the all-skills sweep passes; no branch is dispatched and no PR is touched. → #335

### Counted
- `feature/reconcile-counts-unsliced-waves` — `plot-reconcile-scan.sh` gains a section reporting every `### ` heading that carries more than one branch line, with a machine-countable footer entry the way its seven existing sections have one. It REPORTS and repairs nothing, which is the split Principle 3 states: this collects, `/plot-reslice` and a person conclude. Tests: a plan with a 5-branch wave is reported once with its plan file, its heading and its count; a plan whose waves each hold one branch is silent; a file with no `Phase:` is skipped, the same rule the scan already applies; the footer count matches the number of findings; the section does NOT gate — `attention=` is unchanged, because an unsliced wave is a shape to fix and not a branch that cannot move.

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

**Interrogated 2026-08-22.** The model held; the numbers and the scope moved.

Re-measured across all 84 plans rather than one pulse snapshot: 157 waves, 137
of them single-branch, 20 multi-branch — and **18 of the 20 Released**. The
"repair, not migration" framing survives that intact, which is the strongest
thing an interrogation can say about a premise.

Two live violations rather than one, and the second sharpened the rule. A wave
whose branches have all merged has already done the ordering the rule exists to
protect, so the rule binds waves with **unlanded work**. Without that
qualification the plan would have proposed rewriting the history of everything
the estate has shipped.

**A phantom branch, found while counting and fixed in this branch.** The target
wave reported SIX branches; the sixth was `docs/model-provenance.md`, a file
path cited in a branch line's description:

    - `docs/opus5-hardening-model-provenance` — `docs/model-provenance.md` and …

`plot-plan-meta.sh` takes the first backticked name as the branch and then reads
the second path-shaped token as another one. `plot-dispatch` would have tried to
create a worktree for a markdown file. It is the only such phantom in 84 plans,
and it is precisely the defect `waves-name-themselves` argues from — meta and
content sharing a line — reproduced inside the plan this one is about to slice.
The line is de-backticked here; the general fix belongs to that plan.


<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": false, "architecture": false, "implementation": false},
    "domain": {"rules": false, "workflows": false, "data": false},
    "ux": {"happyPath": false, "edgeCases": false, "errors": false, "accessibility": false},
    "nonFunctional": {"security": false, "performance": false, "scalability": false},
    "tradeOffs": false
  },
  "_note": "Back-filled 2026-08-22: this plan was interrogated once on 2026-08-22 (see ## Notes). The round count is recorded, but the questionHistory could not be reconstructed from prose after the fact, so it is left empty rather than invented."
}
END-CHALLENGE-THE-PLAN-METADATA -->
