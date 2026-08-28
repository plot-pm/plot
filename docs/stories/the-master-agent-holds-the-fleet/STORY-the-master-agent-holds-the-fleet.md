---
title: The master agent holds the fleet
author: jwloka
status: draft
created: 2026-08-28
updated: 2026-08-28
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
- **[Branch](DESIGN-branch.md)** — a wave's unit of work and the claim on it:
  the push *is* the lock, git outranks the plan's annotation, and its state is
  only as fresh as the last fetch — measured, 43 merged branches reading as 0.
- **[Wave](DESIGN-wave.md)** — a plan's unit of dispatch: the slice and the
  ordering, four verdicts of which none is a state, and the entity the fleet is
  built around. Fully derived — no file, no record.
- **[Sprint](DESIGN-sprint.md)** — the timebox: a commitment about *when*, over
  plans that already exist. MoSCoW as graduated promise, the double link to Plan
  that makes `disputed` expressible, and a phase nothing observes — measured
  stale, with a shipped release under an Active sprint.

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
  scan is stateless by design and a delta needs a previous state.
- Where does the harness live — more shell helpers, a board API, or a skill? The
  answer probably differs per job, and pretending otherwise would force one
  shape onto six questions.

## Session Log

- **2026-08-28** — story opened. Prompted by the operator after a session in
  which the supervisor's own tooling was the largest single source of
  disruption: *"lets design a strong but informative harness with powerful
  tooling for the tasks a master agent needs to do to keep the fleet under
  control and the board leverage when asking for status updates."*
