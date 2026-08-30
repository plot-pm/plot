---
title: The master agent holds the fleet
author: jwloka
status: draft
created: 2026-08-28
updated: 2026-08-30
---

# The master agent holds the fleet

## Objective

Give the agent that supervises a Plot fleet the tools to answer, cheaply and
without guessing, the questions it actually has to answer — **can I start work,
is the work progressing, what changed since I looked, and what do I tell the
operator** — and let the board be the surface those answers are shown on rather
than a thing the supervisor competes with.

Plot has 22 helper scripts and they are good. This story is not about missing
capability. It is about the questions a supervisor asks between them, which
today are answered by improvisation — and improvisation is what failed.

## Why Now

One supervised session on 2026-08-27/28, roughly twelve hours, ending with
23 plans delivered and 11 PRs merged. What it cost along the way:

| what happened | how often |
|---|---|
| workers died with `exit 124` and no output | **7** |
| the operator's board became unusable | **3** |
| a diagnosis stated, then measured wrong, then corrected | **4** |
| the operator identified the cause before the supervisor | **3** |

None of it came from a missing script. Every one came from a question the
supervisor answered by inference:

- *Is the machine able to take more work?* — inferred from load average, which
  was wrong; the real signal was **process spawn cost: 3.6 ms healthy,
  286 ms starved, a 79× swing** that no tool reports.
- *Why did that worker die?* — inferred as a Plot defect four times. It was
  machine starvation each time, twice caused by the supervisor's own test run.
- *Is this board hung?* — inferred as starvation once when the process had
  actually exited. Restarting a starved board is the wrong move; restarting a
  dead one is the only move. Nothing distinguished them but `curl` timing.
- *What is the fleet doing right now?* — answered by a hand-written
  `for` loop over worktrees, rewritten from scratch perhaps a dozen times in
  one session, each time slightly differently.

**The board is the second half of the same problem.** It polls a scan that
spawns **115 git processes every 5 seconds**. A supervisor working on the same
machine is not a neutral observer — it is a competing load, and three times it
took the operator's own view away. The tools a supervisor uses and the surface
an operator watches are coupled through a resource neither of them measures.

## Design

These specs are the **foundation for building Plot's domain layer** — one
object per entity, with its source of truth, fields, states, transitions,
relations and the questions it can answer.

**The acceptance criterion: every domain object can be tested with no external
dependency.** No temp directory, no subprocess, no git, no host. Measured
2026-08-28, 34 of the board's 77 unit tests touch disk or spawn a process (44%)
— a test of the deliver *rule* currently needs a temp dir, a written plan file
and a shell subprocess to parse it back.


- **[The fleet's domain entities](DESIGN-entities.md)** — the nine things a
  supervisor reasons about, one at a time: source of truth, states, invariants,
  properties. Designed so far: **Agent** (three competing state models
  reconciled), **Machine** (new — the entity whose absence made `exit 124` read
  as worker failure) and **Person** (new — 84 `Jan Wloka` against 43 `jwloka`
  in one estate's approval records).
- **[Issue](DESIGN-issue.md)** — the board's inbox and Plot's tracker-facing
  entity, specified in full: posture (`Tracker:` vs `Issue tracker:`), the
  domain object, three kinds in both directions, relations to Story/Plan/Sprint,
  actions, scope, four collaborators, fleet control, views and setup.
- **[Story](DESIGN-story.md)** — Plot's umbrella for knowledge that spans plans,
  and the **problem-space** half of the pair: the umbrella hierarchy, the domain
  object, the lifecycle nobody derives, its four relations, and the four-way
  divergence between the estate, the schema, the skill and the lint.
- **[Plan](DESIGN-plan.md)** — the **solution-space** half, and the hub every
  other entity relates through: seven states and the workflow phases they map
  into, the parser as the single contract, and the inversion that Plan is the
  one entity the CLI serves better than the board.
- **[Review, stage 1 — the domain model](DESIGN-review.md)** — a pass over all
  twelve specs: three kinds of identity and what each fails by, four sources of
  state and the rules that follow from them, every cardinality in one place, and
  the ports that would separate the domain from git, the filesystem and the host.
- **[Review, stage 2 — the workflows](DESIGN-review-workflows.md)** — where the
  domain/adapter cut falls across nine workflows: the rule two board modules
  found independently, the one rule that lives twice in two languages with two
  bug histories, and the test that tells a derivation from a re-implementation.
- **[Machine](DESIGN-machine.md)** — the resource every other entity competes
  for, and the only one that does not exist: its symptoms land on whatever *is*
  modelled, which is how `exit 124` came to mean *the worker failed*.
- **[Agent](DESIGN-agent.md)** — a participant with an identity that outlives
  the branch it works on: eight states across three models that disagree, and an
  estate where **every agent row is synthesized** (0 manifests, 13 worktrees).
- **[Worktree](DESIGN-worktree.md)** — a desk: one checkout, one branch, one
  agent, and the only entity that is physical. Its existence is a *measurement*
  — *"a shared file is a prediction, but a desk somebody is sitting at is a
  measurement"* — and five refusals guard every reap.
- **[Release](DESIGN-release.md)** — a version and the plans it contains: the
  tag is the truth, membership is derived with `git tag --contains` rather than
  from dates, and Plot does not cut the version — it cross-checks the notes.
- **[Build](DESIGN-build.md)** — what CI said about a PR, split by price: the
  verdict is free per PR, the history costs a request per branch. Evidence,
  never a gate — Plot refuses nothing on a red build.
- **[PR](DESIGN-pr.md)** — a branch's bid to land and the evidence a plan was
  implemented: the only entity Plot pays per request for, and the one whose
  `state` means different things on different API surfaces — REST says `closed`
  for a PR GraphQL calls `MERGED`.
- **[Branch](DESIGN-branch.md)** — a slice's unit of work and the claim on it:
  the push *is* the lock, git outranks the plan's annotation, and its state is
  only as fresh as the last fetch — measured, 43 merged branches reading as 0.
- **[Slice](DESIGN-slice.md)** — **one branch's worth of a plan's work**, and
  its place in an order: four verdicts of which none is a state, fully derived —
  no file, no record. **Called a Wave until 2026-08-28**, and the rename split
  one word that was doing two jobs (below).
- **[Sprint](DESIGN-sprint.md)** — the timebox: a commitment about *when*, over
  plans that already exist. MoSCoW as graduated promise, the double link to Plan
  that makes `disputed` expressible, and a phase nothing observes — measured
  stale, with a shipped release under an Active sprint.

- **[Ports and adapters](DESIGN-ports.md)** — the layer the entity specs were
  written for: seven driven ports (one per source of truth), three driving ones,
  the rule that an adapter may not decide, and the import-graph gate that keeps
  the domain from reaching a disk. **The adapters already exist** — they are the
  shell scripts the board already spawns.

### Slice and Wave

**A Slice is what one agent works on. A Wave is what the fleet lands together.**

Both were called a Wave until 2026-08-28, and the conflation is why
`Wave 1─1 Branch` was a rule the estate kept enforcing and plans kept breaking —
**21 of 303 sections held several branches**, with `/plot-reslice` existing
solely to repair them.

| | **Slice** | **Wave** |
|---|---|---|
| holds | **exactly one branch, by definition** | **many slices** |
| scope | one plan | **the fleet — slices from several plans** |
| sized by | the work a person cut | **the agents free, bounded by what can land** |
| written | in the plan, as a section | **nowhere — formed at dispatch** |
| **exists today** | yes | **no** |

**Naming them apart dissolved the question rather than answering it.** A section
naming three branches is not a slice holding three — it is a plan nobody has
sliced. Slicing becomes authoring rather than repair.

**The wave is why this story exists.** *The master agent holds the fleet* — the
fleet's unit is the wave, and it is the only entity here with **no source of
truth at all**, because nothing forms one. `plot-dispatch.sh:199` requires a
plan slug, so no component sees eligible slices across plans. The two halves
exist and have never been joined: `plot-fleet-scan.sh` computes eligibility
across all plans, `/plot-merge-queue` computes what can land together. **A wave
is those two, bounded by `parallelAgents`** — which is also
[job 1](#1-can-i-start-work-right-now), stated as an entity instead of a
question.

## Jobs to be done

Written as jobs, not features. Each is a question the supervisor demonstrably
had, with what it did instead.

### 1. Can I start work right now?

**Today:** guessed. Load average was consulted and misled — five workers ran
fine at load 10 on one occasion and starved the machine at load 8 on another,
because the variable was *what else was spawning*, not the count.

**Wanted:** one cheap, honest reading of headroom. Spawn cost is the candidate —
100 trivial `git rev-parse` calls, ~0.4 s, and it separated every good state
from every bad one this session. Under ~10 ms the fleet ran; in the hundreds it
did not, regardless of worker count.

**Not wanted:** a cap the *system* sets. The estate has run 23 rows in WORKING,
and a number derived from headroom alone would be wrong in both directions.

**The cap already exists and belongs to the operator** —
`fleetControls.parallelAgents`, default 3, with a floor of 1 and **no maximum**.
So the want is narrower than "a headroom reading": it is the *ceiling that
control never had*. The operator scales within a range the machine can take;
the reading bounds the dial without taking it away. See
[the design's Elastic section](DESIGN-entities.md).

### 2. Is that worker working, or just alive?

**Today:** `plot-worker-state.sh` answers well and is the strongest tool here —
eight states, and `worker_activity` samples descendant CPU. What it does not
distinguish is *a machine too slow for the worker to finish* from *a worker that
stopped*, and all seven `exit 124` deaths were the former read as the latter.

**Wanted:** the timeout's own verdict, carrying the machine state at the moment
it fired. `exit 124` is `timeout`'s signal; a worker that died at 286 ms/spawn
should say so.

### 3. What changed since I last looked?

**Today:** nothing answers this. The scan re-derives the whole estate every run
and prints a full picture; the supervisor diffs it against memory, badly. Four
of tonight's corrections were "I said X, and X had already changed."

**Wanted:** a delta. *Since your last pulse: 2 PRs merged, 1 worker died, 3
plans became deliverable.* This is also what an operator's status update wants,
which is why it belongs here rather than in the board.

### 4. What is safe to run while the operator is watching?

**Today:** the supervisor learned this by breaking it three times. The rule is
now in memory — never run board tests while the board is open — but it is a
rule, not a gate, and the same class of mistake has other members: a scan, a
suite, a dispatch of five workers.

**Wanted:** the operations classified by what they cost, so a supervisor can
say *this spawns ~46 servers, shall I?* before starting, rather than after the
board goes dark.

### 5. What do I show the operator?

**Today:** prose in a terminal the operator is not reading, plus a board they
are — which the supervisor's own work can take away.

**Wanted:** the board as the status surface, and the supervisor's status
requests served from what the board already computed rather than from a
competing scan. The pulse exists; asking it twice is the waste.

### 6. Which of my own claims have I actually verified?

**Today:** the supervisor stated a cause four times and was wrong four times —
Homebrew `git`'s signature, `episodic-memory sync-cli`, worker count, a test
leak. Each was plausible, each was measured false, and each cost a correction.

**Wanted:** the distinction between *measured* and *inferred* carried in the
statement itself. This is a discipline, not a script — but a harness that makes
measuring cheap is what makes the discipline affordable.

**A shape worth borrowing: a claim carries how it was established.** Three
tiers — *asserted* (someone said so), *machine-confirmed* (something ran and
checked), *human-reviewed* (a person looked) — attached to the claim rather than
kept in the claimant's head.

**Plot already states the rule in two places and enforces it in neither.**
`/plot-deliver` step 5 says *"a deliverable confirmed by reading a PR body
rather than a diff is not confirmed"* and asks subagents to report **what they
EXECUTED versus what they only READ** — the tier distinction, written as prose
an agent is asked to honour. `/plot-release` leaves its sign-off lines blank
under `PLOT_UNATTENDED` because *"an agent writing into them forges it"* — the
same rule, at a different transition.

**The caution is the estate's own measurement.** A tier that can be *asserted*
becomes a box that gets ticked: this repo carries **84 `Jan Wloka` against 43
`jwloka`** in approval records, and sprint items checked over plans that were
never delivered — the `disputed` state exists precisely because a checkbox
outran the truth. **So a tier only helps where something DERIVES it.**
`machine-confirmed` must mean *a gate ran and passed*, never *an agent typed the
word*, and the estate already knows which claims can be derived: a merged PR, a
green build, a passing refusal.

**Not designed here.** It touches every transition record and the deliver
verification, and it is a second story — noted because job 6 is the one job
that currently ends with *"this is a discipline"* and this is the shape that
would make it a gate.

## Excluded from Scope

- **A fleet database.** Manifesto Principle 1 stands: everything re-derived, no
  record. Any state here is a cache checked against its source, the rule
  `PLOT_TERMINAL_CACHE` already follows.
- **Autonomy.** This is a harness for a supervisor that reports to a person, not
  a controller that decides alone. Every gate stays a gate.
- **Making the scan cheaper.** Real, and already its own plan
  (`the-board-watches-instead-of-re-asking`). This story consumes that work; it
  does not repeat it.

## Open Points

- Is spawn cost the right headroom signal, or a proxy for something better? It
  separated every good and bad state this session, but one session is one
  sample.
- Does the delta (job 3) belong in the scan, the board, or a third thing? The
  scan is stateless by design and a delta needs a previous state. **Still open,
  and deliberately deferred**: `production-calls-the-domain-one-rule-at-a-time`
  excludes it because new capability during a migration leaves the corpus tests
  with nothing to compare against — production would hold no implementation of
  the new rule. It needs its own plan once the domain is the only
  implementation.
- ~~Where does the harness live — more shell helpers, a board API, or a skill?~~
  **Answered 2026-08-30: it lives in `@plot-pm/domain`, and the shell scripts
  are its adapters.** None of the three options was right, because the question
  assumed the harness would be a new component beside the existing ones. It is
  a layer instead: the scripts already adapt the world into readings
  ([DESIGN-ports.md §4](DESIGN-ports.md#4-the-adapters-already-exist) — *"every
  driven port already has a working adapter, and it is a shell script"*), and
  what was missing was somewhere for the decisions to live once the readings
  arrive.

  **The answer is a placement, not a completion.** The seven ports and their
  adapters exist as of `feature/the-ports-have-adapters`; the driving side —
  who ASKS the domain — is still being built across the remaining slices of
  `the-domain-runs-the-workflows-in-a-sandbox`. That is construction, not an
  open question: where it goes is settled.

  **The worry that one shape would be forced onto six questions did not
  survive contact.** The six workflows differ in what they read and what they
  decide, not in whether they are readings-then-decision — and expressing them
  showed two (`implement`, `release`) have no script at all, which the "more
  shell helpers" option would have hidden rather than surfaced.

## Session Log

- **2026-08-28** — story opened. Prompted by the operator after a session in
  which the supervisor's own tooling was the largest single source of
  disruption: *"lets design a strong but informative harness with powerful
  tooling for the tasks a master agent needs to do to keep the fleet under
  control and the board leverage when asking for status updates."*
