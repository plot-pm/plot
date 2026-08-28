---
title: The Plot domain — review, stage 1: the domain model
story: the-master-agent-holds-the-fleet
author: jwloka
status: draft
created: 2026-08-28
updated: 2026-08-28
---

# The Plot domain — review (stage 1: the model)

A pass over all twelve entity specs: what holds, what disagrees, and how the
domain separates from the infrastructure it currently sits inside.

> **Story:** [The master agent holds the fleet](STORY-the-master-agent-holds-the-fleet.md)
>
> **Specs:** [Issue](DESIGN-issue.md) · [Story](DESIGN-story.md) ·
> [Plan](DESIGN-plan.md) · [Sprint](DESIGN-sprint.md) · [Wave](DESIGN-wave.md) ·
> [Branch](DESIGN-branch.md) · [PR](DESIGN-pr.md) · [Build](DESIGN-build.md) ·
> [Release](DESIGN-release.md) · [Worktree](DESIGN-worktree.md) ·
> [Agent](DESIGN-agent.md) · [Machine](DESIGN-machine.md) ·
> [Entities](DESIGN-entities.md)

## Contents

**Stage 1 of three: the domain model.**

| § | section |
|---|---|
| 1 | [Identity: three kinds](#1-identity-three-kinds) |
| 2 | [State: where each entity's truth lives](#2-state-where-each-entitys-truth-lives) |
| 3 | [Cardinalities, in one place](#3-cardinalities-in-one-place) |
| 4 | [What the review found wrong](#4-what-the-review-found-wrong) |
| 5 | [Ports and adapters](#5-ports-and-adapters) |
| 6 | [Next stages](#6-next-stages) |
| 7 | [What is unresolved](#7-what-is-unresolved) |

---

## 1. Identity: three kinds

**Twelve entities, and their identities fall into three kinds — which nothing
states, and which predicts each one's lifecycle.**

| kind | entities | identity is | who assigns it |
|---|---|---|---|
| **slug** | Plan, Story, Sprint | a name a human chose | **a person, once** |
| **natural key** | Branch, PR, Release, Issue, Build, Worktree | whatever the source calls it | **the source** |
| **minted** | Agent (`session`), Wave (`plan#name`) | composed or generated | **Plot** |

**Machine has none** — there is exactly one (Machine §3), and that singularity is
load-bearing: if there were two, headroom would be a property of a *pair*.

### The kind predicts the failure mode

| kind | fails by |
|---|---|
| slug | **collision** — 158 plans, 0 duplicates, **nothing enforcing it** (Plan §3) |
| natural key | **the source lying** — `state: CLOSED` on a merged PR (PR §4) |
| minted | **nobody minting** — 0 manifests, 13 worktrees (Agent §3) |

**That last row is the Registry gap stated as a consequence of identity**: a
minted identity needs an owner, and `readAgentRegistry` only reads.

---

## 2. State: where each entity's truth lives

**Four sources, and every design rule in this estate follows from which one an
entity uses.**

| source | entities | goes wrong by |
|---|---|---|
| **STATED** in a file | Plan · Story · Sprint | **being wrong** — a file can say `Approved` when nobody approved |
| **DERIVED** from local facts | Wave · Branch · Release · Agent · Worktree · Issue | **staleness** — a `--no-fetch` scan read 43 merged branches as open |
| **FOREIGN** | PR · Build | **the surface disagreeing** — REST `closed` vs GraphQL `MERGED` |
| **MEASURED** | Machine | **decaying instantly** — the next process anyone starts |

### The four rules fall out of this table

| rule | because |
|---|---|
| transitions are **gated** | a STATED state can be wrong, so writing it needs a check |
| derivations are **re-run every pulse** | a DERIVED state is a claim about a moment |
| **askability** is carried apart from the answer | a FOREIGN source may not answer at all |
| a reading carries **`measuredAt`** | a MEASURED value is only true when taken |

**This is the spine of the whole design**, and it was never written in one
place until now.

---

## 3. Cardinalities, in one place

**84 relation rows across twelve specs; 65 state a cardinality. Consolidated:**

```
Story 1 ──── * Plan                    a story spans plans; a plan has ≤1 story
Sprint 1 ─── * Plan                    a plan has ≤1 sprint; a sprint has many
Release 1 ── * Plan                    derived from tags
Sprint * ─── 1 Release                 TWO sprints may target one release
Plan 1 ───── * Wave                    ordered; position is the ordering
Wave 1 ───── 1 Branch                  INTENDED; 271 of 303 conform, 21 hold more, 11 hold none
Branch 1 ─── * PR                      372 have one, 9 have two, ONE has ten
PR 1 ─────── 1 BuildRollup             free, per PR
Branch 1 ─── * Build                   the history, metered
Agent 1 ──── 1 Worktree                the agent OWNS its desk
Agent 1 ──── * Wave                    over time — one at a time, then --next
Worktree 1 ─ 1 Branch                  while checked out
Machine 1 ── * everything              one machine, many tenants
Issue * ──── * Plan                    a plan answers several; a signal fans into n plans
```

### Three that are not what they look like

**`Wave 1 ─ 1 Branch` is intended and violated**: 21 waves hold several, 11 hold
none — and 9 of those 11 are prose headings the parser reads as waves (Wave §8).

**`Agent 1 ─ * Wave` is over time, not concurrent.** An agent takes one unit,
completes it, asks `--next`. The loop implements it; the desk does not persist,
which is the divergence (Agent §1).

**`Branch 1 ─ * PR` surprises**: one branch here carries **ten** PRs, so *has
this branch landed?* means *did any of them merge* — which is why `mergedAt`
outranks `state` (PR §4).

---

## 4. What the review found wrong

### 4a. One relation is stated in two directions

`Branch → Agent` (Branch §6) against `Agent → Worktree` (Agent §6, Worktree §6).

**The ownership rule settles it**: the agent owns the desk, and the branch is
what it works on. So `Branch → Agent` should be `Agent → Branch`, and the
`worker_*` fields on a branch row are the projection the entities doc already
argues should become `branch.agent`.

### 4b. Cardinality is stated inline, never collected

**19 of 84 rows state none at all**, and no spec carries the diagram §3 above
now holds. A reader wanting *how many waves does a plan have* reads twelve
files.

### 4c. Three specs carry the same open question

*Where does the controller live when no board is open?* — Build §14,
entities §Open, and the composition section. **It is one question**, and it
decides where every monitor runs.

### 4d. The identity kinds were never named

§1 above is new. Each spec states its own identity; none says there are three
kinds, or that the kind predicts the failure.

---

## 5. Ports and adapters

**The goal: the domain does not know that git, a filesystem, a host CLI or a
process table exist.**

### What the domain is

**Twelve entities, their states, their relations, and the rules that gate
transitions.** Nothing else. It is pure: given the same inputs it returns the
same answers, and it can be constructed in memory.

### The ports — one per source of truth (§2)

**Driven ports** (the domain asks the world):

| port | answers | today's adapter |
|---|---|---|
| `PlanStore` | plan/story/sprint files | `plot-plan-meta.sh` + `fs` |
| `Refs` | branch state, merges, tags | `git`, `plot-fleet-scan.sh` |
| `Host` | PRs, builds, issues | **`plot-host.sh` — already one place** |
| `Processes` | is this pid alive, what did it exit with | `plot-worker-state.sh` |
| `Trees` | worktree list, cleanliness | `git worktree` |
| `Clock` | now, and elapsed | `Date.now()` |
| `Machine` | spawn cost | 100 × `git rev-parse` |

**Driving ports** (the world asks the domain):

| port | used by |
|---|---|
| `FleetQuery` | the board, the master agent — *what is the state?* |
| `FleetCommand` | the spoke commands — *approve, deliver, dispatch* |
| `FleetEvents` | subscribers — *what changed* (job 3) |

### `plot-host.sh` is the pattern, already proven

**One adapter, one vocabulary, three outcomes kept apart** — and CLAUDE.md
names it *"the ONE place that talks to the host CLI."*

**Its measured violation is the argument for the rest**: `plot-reap.sh` calls
`gh` directly to read `mergedAt`, because the adapter did not expose it — so a
consumer reached past the port rather than extending it (PR §13).

### What the separation buys, measured

**The acceptance criterion is already stated** (entities §What these specs are
for): every domain object testable with no external dependency.

**Today 34 of 77 unit tests touch disk or spawn** — 28 `mkdtemp`, 25 subprocess, 19 both.
A test of the *deliver rule* writes a `docs/plans/` tree and shells out to a
parser, to ask *is every non-deferred branch merged?*

**With ports, that test constructs a Plan and asserts.** The filesystem test
moves to the adapter, where it belongs and where it is one test rather than
thirty-four.

### The rule that keeps adapters honest

**An adapter may not decide.** `plot-host.sh` states it: *"this collects, a
human concludes"* — and `plot-sprint-release.sh` too: *"a script that refused
would be making this call itself."*

**So a port returns facts and the domain applies rules**, which is Manifesto
Principle 3 expressed as an architecture rather than as a convention.

---

## 6. Next stages

**This document is stage 1 of three**, and stops here deliberately:

| stage | covers | state |
|---|---|---|
| **1 — domain model** | identity, state, cardinalities, ports | **this document** |
| **2 — workflows** | modelling the existing and new flows into the domain | **[written](DESIGN-review-workflows.md)** |
| **3 — comparison** | capabilities against other agent runtimes | after 2 |

---

## 7. What is unresolved

| # | question | blocks |
|---|---|---|
| 1 | **Where do monitors live when the board is closed?** | every monitor's design |
| 2 | **Is the wave-per-agent desk reused or recreated?** | the Registry's contract |
| 3 | **Are the Machine thresholds right?** | one session, one sample |
| 4 | **Does `Wave 1─1 Branch` get enforced or relaxed?** | 21 waves disagree |
| 5 | **Should the parser emit a plan slug?** | two duplicated functions say yes |

**1 is the one to settle first**, because it is the only one three specs are
waiting on.
