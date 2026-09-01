---
title: Machine — domain object specification
story: the-master-agent-holds-the-fleet
author: jwloka
status: draft
created: 2026-08-28
updated: 2026-09-01
---

# Machine — domain object specification

The resource every other entity competes for, and the only one whose absence
made four diagnoses wrong.

> **Story:** [The master agent holds the fleet](STORY-the-master-agent-holds-the-fleet.md)
>
> **Companions:** [Entities](DESIGN-entities.md) · [Agent](DESIGN-agent.md) ·
> [Worktree](DESIGN-worktree.md) · [Build](DESIGN-build.md) ·
> [Budget](DESIGN-budget.md)

## Contents

| § | section | answers |
|---|---|---|
| 1 | [What a Machine is](#1-what-a-machine-is) | why it must exist |
| 2 | [Posture](#2-posture) | none — it reads the hardware |
| 3 | [The domain object](#3-the-domain-object) | **the normative spec** |
| 4 | [Lifecycle](#4-lifecycle) | a state that is a moment |
| 5 | [Direction](#5-direction) | none |
| 6 | [Relations](#6-relations) | Agent · Worktree · everything |
| 7 | [Actions](#7-actions) | measure — and nothing else |
| 8 | [Scope](#8-scope) | several machines, one computer, and what shares it |
| 9 | [The collaborators](#9-the-collaborators) | a Monitor, and why not a Manager |
| 10 | [Fleet control](#10-fleet-control) | the ceiling on the operator's dial |
| 11 | [Views](#11-views) | headroom beside the stepper |
| 12 | [Setup](#12-setup) | none |
| 13 | [Gaps](#13-gaps) | it does not exist |
| 14 | [Invariants and open points](#14-invariants-and-open-points) | |

---

## 1. What a Machine is

**A Machine is a Plot instance, and the resource every other entity competes for
is the computer under it** — the CPU, its cores, the cost of a fork. Nothing
models either.

**So its symptoms land on whatever entity *is* modelled**, which is the whole
reason it must exist:

| what happened | what it was blamed on | what it was |
|---|---|---|
| **7 workers died `exit 124`** | a Plot defect, four times | **machine starvation** |
| the board went dark, **3×** | a test leak, worker count | competing load |
| spawn cost 3.6 → 286 ms | Homebrew git's signature | starvation, a symptom |
| `episodic-memory` at 12.3/16 cores | the driver | a finite indexing burst |

**`exit 124` is `timeout`'s signal.** It means *the clock ran out* — and with no
Machine entity, the only available reading is *the worker stopped*. Those are
opposite conclusions: one says restart on a quieter machine, the other says the
work is broken.

**This is the same defect as `state: CLOSED` on a merged PR** — a value honest
about its own source and misleading about the question actually being asked. The
fix is the same: model the thing the value is really about.

---

## 2. Posture

**None.** A Machine reads hardware. No tracker, no host, no config changes what
it reads — and it is the only entity here whose truth is neither git, a file, a
host nor a process, but **the operating system**.

**Its identity is not read from the operating system**, though (§3): `hostname()`
returns the same string for the three instances measured on this laptop. The
readings come from the OS; the key comes from where the instance was started.

---

## 3. The domain object

> **Identity: `hostname` + a short id**, because several Plot instances run on
> one computer — measured three, on one laptop, all reporting `ani`. The short
> id is a hash of `repoRoot + scriptsDir`, which is the key
> [`fleet.ts:646`](../../../packages/board/src/server/fleet.ts) already caches by.
> It is the one entity that splits its readings between **the instance** and
> **the computer under it**, and only the instance half is keyed.
> **State: MEASURED** — the fourth
> [source](DESIGN-review.md#2-state-where-each-entitys-truth-lives), and the only
> one that **decays instantly**: the next process anyone starts invalidates it,
> which is why a reading carries `measuredAt`.


### Identity

**A Machine is a Plot instance, and several run on one computer.** Its identity
is `hostname` + a short id:

```
ani/a9069063      Agentic-Tools/plot
ani/<8 hex>       Agentic-Tools/agent-skills
ani/<8 hex>       EKZ.Webportal/ekzweb
```

The first row is computed, from
`sha256(repoRoot + "\0" + scriptsDir).slice(0, 8)`. The other two are shown as
shapes rather than digits: **the derivation is normative, the digits are not** —
they follow from wherever each project happens to sit on disk.

**This corrects the spec.** It read *"A Machine has no identity, because there is
exactly one"*, and named the exact condition that would refute it: *"if there
were two, headroom would be a property of a pair and the whole entity would need
a key."* **That condition is the working environment.**

**Measured 2026-08-30, re-measured 2026-09-01** — each verified for a
`## Plot Config` section *and* a `.plot/` directory, not merely for the name:

```
Agentic-Tools/plot          Plot Config: yes    .plot/: yes
Agentic-Tools/agent-skills  Plot Config: yes    .plot/: yes
EKZ.Webportal/ekzweb        Plot Config: yes    .plot/: yes

hostname:  ani              — the same string for all three
```

#### Why `hostname()` alone is not an identity

**It returns `ani` for all three.** The port declares
`hostname()` ([`ports/machine.ts:44`](../../../packages/domain/src/ports/machine.ts))
as though it named one thing, and on this laptop it names three. It stays
useful and stays insufficient: **the hostname is what makes an id unique beyond
this computer** — a fleet spanning laptops must say *which* `ani` — and the
short id is what separates instances on one.

#### The short id is a hash of `repoRoot + scriptsDir`

**Decided here; the plan recorded both candidates.** The alternative was
`basename(repoRoot)`, which is readable — `plot`, `agent-skills`, `ekzweb` —
and loses on one case:

| | three projects | a board in a worktree |
|---|---|---|
| `basename(repoRoot)` | readable | **`docs-a-machine-has-an-identity`** — renames itself with the branch, and vanishes when the branch is reaped |
| **hash of `repoRoot + scriptsDir`** | `a9069063` — opaque | **stable across a rename** |

**The worktree case is measured, not hypothetical.** This repo runs boards from
worktrees in its own suite, and carried **six live ones** on 2026-09-01 — every
name a branch name, every one of them reapable. An id that dies with a branch
cannot key a `machineAtDeath` record that outlives it.

**A readable id is worth something to an operator reading a log; a stable one is
worth more to a machine that must stay itself.** The hash wins because the id's
job is correlation across time, and the log can carry `repoRoot` beside it.

#### It must cover both axes, not just the repo

`repoRoot` is `PLOT_REPO_ROOT ?? process.cwd()`; `scriptsDir` is
`PLOT_SCRIPTS_DIR ??` the artifact's own directory
([`index.ts:64-65`](../../../packages/board/src/server/index.ts)). **They vary
independently** — one follows the working directory, the other follows where the
board was installed from.

**So an id derived from the repo alone would merge two machines the cache
already keeps apart.** `fleet.ts:646` keys every cache — and therefore every
pulse, every PR timer, every estate — by `` `${opts.repoRoot}\0${opts.scriptsDir}` ``.
**That key is the identity**, and this section only names what was already
there.

Computed the same way, this document's own two checkouts differ:

```
/Users/jwloka/Quatico/Agentic-Tools/plot                    → ani/a9069063
/Users/jwloka/…/plot/.worktrees/docs-a-machine-has-an-identity → ani/e4a46dad
```

### Two entities, one of which was missing

**The readings split, and only half of them are the instance's.**

| | **Machine** (instance) | **Computer** (hardware) |
|---|---|---|
| identified by | `hostname` + short id, from `repoRoot + scriptsDir` | `hostname()` |
| how many | **one per Plot project** | one |
| owns | its pulse, its fleet, its estate, its divisors | `spawnCostMs`, `loadAverage`, `cores` |
| answers | *whose clock is this?* | *can anything fork cheaply right now?* |

**Three instances measuring one spawn cost is not duplication** — it is three
tenants reading one meter. §8 already said so without drawing the conclusion:
*"headroom is not this fleet's headroom, it is the machine's, and the fleet is
one tenant among several."* **Read against three instances, "the machine" there
is the hardware.**

**Not chosen: renaming `Machine` to `Instance`.** The word is in
`DESIGN-agent.md`, `DESIGN-worktree.md`, `ports/machine.ts`, `entities/machine.ts`,
its adapter and its tests. A rename is a large diff that changes no meaning —
and the meaning was never wrong, only the count.

### Fields

**The table separates what the computer supplies from what the instance owns.**
Every row is read the same way it always was; what changed is which entity owns
it.

**Read from the computer** — one measurement, shared by every instance on it:

| field | type | note |
|---|---|---|
| `spawnCostMs` | number \| null | **the signal** — null when unmeasured |
| `loadAverage` | [1m, 5m, 15m] | **context only, never the verdict** |
| `cores` | number | context |

**Owned by the instance** — its own reading of the computer, and its own claim
on it:

| field | type | note |
|---|---|---|
| `id` | `hostname/shortId` | **the correction** — `hostname()` alone names three instances |
| `headroom` | `clear`\|`tight`\|`starved`\|`unmeasured` | derived from `spawnCostMs` |
| `measuredAt` | ISO-8601 | **required** — a reading without one cannot be judged stale |
| `sampleMs` | number | **what this instance's measurement cost** |
| `parallelAgents` | number | **a claimed share of the computer, not a measurement** — see below |

#### `parallelAgents` is a claim, and its default is not a measurement

**The same number, a different question.** It reads today as *"how many agents do
I want"*; under two entities it means *"what share of the computer do I claim"* —
and the second question is answerable by an operator who knows three projects are
running.

**A machine does not negotiate its share; it declares one.** Nothing arbitrates,
and nothing needs to: the sum is the operator's to keep sensible, exactly as it
is for any three programs sharing a laptop.

**Measured 2026-09-01 — an unset share is still a share:**

```
Agentic-Tools/plot          {"autoDispatch":false,"parallelAgents":4,"machineOverride":false}
Agentic-Tools/agent-skills  no fleet-controls.json
EKZ.Webportal/ekzweb        no fleet-controls.json
```

**Only one instance has ever claimed a share.** The other two run on
config-seeded defaults
([`fleet-settings.ts:124`](../../../packages/board/src/server/fleet-settings.ts),
`PARALLEL_AGENTS_DEFAULT = 3`), which means **the share is implicit for two of
the three machines, not merely unreported**. A machine that never chose still
takes CPU, and its default is seeded from its own config rather than from
anything that knows two other projects exist.

**Known blind spot, recorded and not solved: nothing reports the sum.** No
component reads what the three instances have claimed between them, and two of
them have never said. **That is a reporting gap, not an arbitration one** (§13,
gap 5) — a scheduler would be the wrong answer to it.

### Why spawn cost, and not load average

**Load average was tried and misled.** *"Five workers ran fine at load 10 on one
occasion and starved the machine at load 8 on another, because the variable was
**what else was spawning**, not the count."*

**Spawn cost separated every good state from every bad one**, and it does so
because it measures the thing Plot actually does: fork a process. A fleet is
thousands of `git rev-parse` calls, so the cost of one is the cost of everything.

**Measured 2026-08-28, three consecutive runs:**

```
3.8 ms   3.6 ms   3.6 ms        ← clear, and reproducible
```

against the story's starved reading of **286 ms** — a **79× swing** on the same
hardware.

### The observer must price itself

**`sampleMs` is not decoration.** A headroom measurement that costs meaningfully
under load makes the observer part of the problem — which is the story's own
complaint, restated as a constraint on its fix.

**Measured: 374 ms for 100 spawns**, against a fleet scan at **18.3 s**. So one
reading costs **2% of one scan**, and a reading per pulse is affordable where a
second scan would not be.

---

## 4. Lifecycle

### The state is a moment, not a transition

| headroom | spawn cost | means |
|---|---|---|
| `clear` | **< ~10 ms** | dispatch freely |
| `tight` | ~10–50 ms | finish what is running; do not add |
| `starved` | **> ~50 ms** | **the operator's board is already suffering** |
| `unmeasured` | — | not asked, or the measurement failed |

Source: [`diagrams/machine-lifecycle.mmd`](diagrams/machine-lifecycle.mmd)

```mermaid
stateDiagram-v2
  [*] --> unmeasured
  unmeasured --> clear : spawn under 10 ms
  unmeasured --> tight : spawn 10 to 50 ms
  unmeasured --> starved : spawn over 50 ms
  clear --> tight
  tight --> starved
  starved --> tight
  tight --> clear
  clear --> unmeasured : reading stale
  tight --> unmeasured : reading stale
  starved --> unmeasured : reading stale

  note right of unmeasured
    A moment, not a transition.
    unmeasured is not permission to dispatch.
    measuredAt is required.
  end note
```

**The thresholds are provisional and must be re-measured.** They come from one
session — one sample — and this document says so rather than presenting them as
settled.

### It decays without anyone touching anything

**Machine is the second entity with that property** (Branch §4 is the other),
and it decays faster: a Branch's state goes stale at the next push, a Machine's
at the next process anyone starts.

**So `measuredAt` is required, not optional.** A headroom value without its
timestamp is a snapshot without a date — precisely the mistake made when reading
a `--no-fetch` scan as authoritative (Branch §4).

---

## 5. Direction

**None.** Nothing outside creates or consumes a Machine; it is observed and
never written.

---

## 6. Relations

| relation | mechanism |
|---|---|
| **Computer → Machine** | **one computer hosts several instances** — three measured (§3) |
| Machine → Computer | it reads headroom; it does not own it |
| Machine → **everything in it** | every entity's derivation runs on this instance |
| Agent → Machine **at death** | `machineAtDeath` (Agent §3) |
| Worktree → Machine | disk, and a recursive tool's cost (Worktree §12) |
| Build → Computer | **no** — CI runs elsewhere |

Source: [`diagrams/machine-relations.mmd`](diagrams/machine-relations.mmd)

```mermaid
classDiagram
  direction LR

  class Computer
  class Machine
  class Agent
  class Worktree
  class Build

  Computer "1" --> "*" Machine : hosts
  Machine --> Computer : reads headroom
  Machine "1" --> "*" Agent : hosts
  Agent --> Machine : machineAtDeath
  Worktree --> Machine : disk cost
  Build .. Computer : CI runs elsewhere
```

**`machineAtDeath` names an instance, and that is what the id is for** (§3). A
scan finding a dead worker on this laptop must be able to say *which* of the
three machines it died on, and `ani` alone does not.

**`machineAtDeath` is the relation that matters**, and it is why the
`AgentMonitor` must be attached at creation (Agent §9): *a scan finding a dead
worker cannot know what the machine was like when it died.*

**Build is the one entity that shares neither** — CI runs on the host's
hardware, which is why a red build says nothing about local headroom.

---

## 7. Actions

**One: measure.** And explicitly **not**:

| not | why |
|---|---|
| kill an agent | never Plot's call |
| throttle the fleet | the operator's dial, not the controller's |

**Amended 2026-08-30: it also provides, and at `starved` it defers.** *"Refuse a
dispatch"* stood here until a distinction was drawn that this row had collapsed:
**refusing ends the dispatch, deferring postpones it.** The machine now provides
the worker and says *not yet* while it is starved, with the number it measured;
the operator may proceed anyway. See §10 for the argument and the exact
boundary. The other two rows are unchanged and are not weakened by it — a
deferral spends nothing the operator owns, while a kill and a throttle both do.

**The controller may throttle *itself*** — its own cadences, its own metered
fetches, its own test runs — because that spends nothing the operator owns
(entities §Elastic).

---

## 8. Scope

**One computer, several machines on it, and the supervisor is on the same
computer as all of them.**

**That is the story's central coupling:** *"the board polls a scan that spawns
115 git processes every 5 seconds. A supervisor working on the same machine is
not a neutral observer — it is a competing load, and three times it took the
operator's own view away."*

**What shares it**, measured across this session: the board, 13 agents, the
scan, the supervisor's own tool calls, and everything else on the laptop —
including an indexing burst that held 12.3 of 16 cores.

### Rewritten against the measured three

**This section argued the entity was singular**, and rested the whole of §3's
*"no identity"* on it: *headroom is not this fleet's headroom, it is the
machine's, and the fleet is one tenant among several.*

**That sentence is right, and it is about the computer.** Three Plot instances
run here (§3). Each measures the same spawn cost, on the same 16 cores, and each
calls the reading its own. **The tenant list was never one fleet long** — it
already named the board, the agents and an indexing burst, and it simply did not
name the other two Plot instances that were also on it.

**So what is singular is the computer, and what is plural is the machine.**
Headroom is a property of the hardware; the reading of it, the pulse that takes
it, and the share claimed against it are properties of an instance.

**Nothing about the readings changes.** Spawn cost is measured the same way and
means the same thing; the correction is which entity owns it, and that the
owning entity needs a key.

---

## 9. The collaborators

### `MachineMonitor` — one, and there is no Manager

**Unlike Agent and Worktree, Machine needs no manager**, because there is
nothing to own: no creation, no removal, no pairing. Plot does not manage
hardware.

**What it needs is a monitor**, and the difference from the others is scope:

| monitor | watches | stops when |
|---|---|---|
| `AgentMonitor` | one agent | that agent exits |
| `WorktreeMonitor` | one tree | its agent is gone |
| **`MachineMonitor`** | **its own instance** | **never — the instance outlives every agent in it** |

**A single long-lived reading per instance**, sampled on a cadence and shared
by every consumer inside it — not one per agent, which would multiply the very
cost it measures.

**One monitor per Plot instance, and each reads the same computer** (§3). That
is three tenants reading one meter, not three copies of one monitor: each
samples on its own cadence, dates its own reading, and reports to its own board.
The cost is the reason it stays one per instance rather than one per agent —
374 ms a sample against an 18.3 s scan, times the agents, is what a monitor is
for avoiding.

### What it must supply

| to | what |
|---|---|
| the **board** | headroom beside the `parallelAgents` stepper (§11) |
| the **master agent** | *can I start work right now?* (job 1) |
| the **AgentMonitor** | the reading at an agent's exit — `machineAtDeath` |

---

## 10. Fleet control

**Machine's job is the ceiling on a control that already exists.**

`fleetControls.parallelAgents` ships with `MIN_PARALLEL_AGENTS = 1` and **no
maximum** — so the stepper climbs forever with nothing saying where the
machine's range ends.

| what the operator sees | source | whose |
|---|---|---|
| the dial, at 3 | `parallelAgents` — **exists** | **the instance's claim** |
| slots taken | `liveAgentCount` — **exists** | the instance |
| **what the computer can take** | **Machine — does not exist** | the computer |
| **what every instance has claimed** | **nothing reports it** | across instances |

**It bounds, and at `starved` it says *not yet*.** Elastic means *the operator
scales within a range the machine can take* — the controller reports the range
and a person chooses inside it.

#### The dial claims a share; the ceiling is the computer's

**The two rows above answer different questions**, and the entity split (§3) is
what separates them. `parallelAgents` is what *this instance* claims. The
ceiling it should be bounded by is a property of the *computer*, which every
instance shares — so a ceiling derived from spawn cost bounds the dial correctly
without any instance knowing what the others took.

**The share is not negotiated, and an unset one is still a share.** Two of the
three instances measured here have no `fleet-controls.json` at all and run on a
config-seeded default of `3` (§3). They claim CPU without ever having said so.

**Row 4 is the blind spot, and this document records it rather than solving
it.** Nothing sums the claims. **A scheduler would be the wrong answer** — the
sum is the operator's to keep sensible, exactly as it is for any three programs
sharing a laptop, and the machine's job is to report what it is getting rather
than to bargain for more. What is missing is a *report*, and it is filed as
such (§13, gap 5).

#### Superseded the same day: there is nothing to refuse

**Operator decision, 2026-08-30, and it dissolves the question above rather than
answering it.** The deferral below was designed for a dispatch arriving while the
machine is starved. In the shape settled that day, that request never arrives.

**A first version of this had the machine start idle workers for agents to
claim. It was withdrawn** — a worker is a *relation*, the process an agent runs
on a machine, so an idle worker with no agent is not unpaired but absent
(`DESIGN-agent.md` §*Agent and Worker are one entity*). **No new object is
needed.**

```
the operator asks the REGISTRY for N agents
    → the registry SPAWNS each agent; spawning it IS starting its process
    → that process is the worker. Nothing can start a worker on its own
the agents work, and the machine comes under pressure from what they DO
    → not from a request arriving at it
a dispatch goes to a FREE agent — running, between units, holding no slice
    → so a dispatch never asks the machine for capacity
```

**"No free agent" is a count, not a prediction.** That is what dissolves the
argument below: *headroom is a forecast and a forecast does not earn a refusal*
is true, and irrelevant to counting. `0 free` is the same kind of fact as *this
branch is claimed* — already the whole of Plot's locking:

> *"The push is the claim, and it is the whole locking mechanism"*
> — `DESIGN-branch.md` §the claim

**So the machine neither refuses nor defers.** It measures the pressure the
agents create and reports it; the operator reads that when choosing N. The
decision moves to a moment where a person is already deciding, which is where §7
always wanted it — and `starved` becomes what it was designed to be in §5: a
reading, shown to whoever sets the dial.

**`DESIGN-agent.md` already had the missing half.** Availability is defined
there, separated from the eight process states, and derived rather than stored.
What neither spec said is that **a dispatch looks at it** — which is why this
one spent two revisions arguing about predicting capacity while the other was
already counting it.

**Revised 2026-08-30.** This section read *"it bounds; it never refuses"* and
grounded that on a real distinction: **Plot's gates refuse on measurements of
harm already done** — a live pid, an unmerged branch — whereas **headroom was
called a prediction about capacity**, which does not earn a refusal.

**Two things break that reading.**

**First, `starved` is not a prediction.** §5 chose spawn cost over load average
precisely because it *measures the thing Plot does*: fork a process. The reading
is `3.6 ms` clear against `286 ms` starved — a 79× swing on the same hardware,
taken now, not extrapolated. A machine that cannot fork cheaply **is** harmed,
in the same sense a live pid is a fact rather than a forecast.

**Second, deferring is not refusing.** The three forbidden actions in §7 share
one shape: each takes something away from the operator permanently — a dispatch
that will not happen, an agent that is dead, a fleet held below what was asked.
**"Not yet" takes nothing away.** The dispatch stands, the dial keeps its value,
and the work starts when the reading clears. The operator can always say *now
anyway* — and that is what keeps this a deferral rather than a veto.

**What the machine may therefore do**, and only this:

| at | the machine |
|---|---|
| `clear` / `tight` | provides the worker |
| `starved` | **says *not yet*, and says what it measured** |
| any reading | never kills an agent, never moves the dial |

**The refusal must name its number.** *"Not yet: spawn cost 286 ms against a
clear reading of 3.6 ms"* is answerable; *"too much load"* is not, and load
average is explicitly not the verdict (§5).

**This does not license refusing on a stale reading.** `measuredAt` is required
for exactly this reason: a `starved` reading nobody can date is `unmeasured`,
and `unmeasured` provides the worker. Silence is never a refusal.

---

## 11. Views

| view | shows |
|---|---|
| beside the stepper | *room for more* · *at the edge* · *the board is suffering* |
| an agent's death | `machineAtDeath`, so `exit 124` names its cause |

**`unmeasured` renders as *capacity unknown*, never as room** — absent is not
false, applied to headroom.

---

## 12. Setup

**None.** There is nothing to configure: no path, no host, no credential. The
thresholds (§4) are the only tunable, and they are provisional enough that
hard-coding them and re-measuring is more honest than a key nobody could set
correctly.

---

## 13. Gaps

**The entity does not exist.** Every row below is *unbuilt*, not *broken*.

| # | gap |
|---|---|
| 1 | **No Machine entity at all** — its symptoms land on Agent, and did four times |
| 2 | **No `machineAtDeath`** — `exit 124` cannot name its cause |
| 3 | **No ceiling on `parallelAgents`** — floor 1, no maximum |
| 4 | **Nothing prices an operation before it runs** — job 4 |
| 5 | **Nothing reports the sum of the instances' claims** — three machines here, one has ever set `parallelAgents`, and no component reads across them (§3, §10). A **reporting** gap: arbitration is explicitly not wanted |
| 6 | **No instance id is minted or recorded** — the key exists in `fleet.ts:646` as a cache key, and nothing surfaces it as the machine's identity |

---

## 14. Invariants and open points

### Invariants

1. **Measured, never inferred** — load average is context, spawn cost is the
   verdict.
2. **A reading has a timestamp**, and goes stale faster than any other entity's.
3. **The observer prices itself** — 374 ms against an 18.3 s scan.
4. **It defers, and never refuses** — at `starved` it says *not yet* with the
   number it measured; the operator may proceed anyway. It bounds a dial only
   the operator moves, and it never takes a dispatch away (§7, §10).
5. **There is one per Plot project, and one computer under them all** — the
   fleet is one tenant on the computer, and so is every other instance (§3, §8).
6. **The controller may throttle itself; only the operator resizes the fleet.**

### Open points

- **Are the thresholds right?** One session, one sample. They should be
  re-measured across machines before anything renders them as advice.
- **Is spawn cost the right signal or a proxy?** It separated every observed
  good and bad state, which is evidence, not proof — it may stand in for I/O
  wait, memory pressure, or `syspolicyd` queue depth.
