---
title: Agent — domain object specification
story: the-master-agent-holds-the-fleet
author: jwloka
status: draft
created: 2026-08-28
updated: 2026-08-28
---

# Agent — domain object specification

A participant in the fleet: something with an identity that outlives the branch
it is working on.

> **Story:** [The master agent holds the fleet](STORY-the-master-agent-holds-the-fleet.md)
>
> **Companions:** [Entities](DESIGN-entities.md) · [Worktree](DESIGN-worktree.md) ·
> [Branch](DESIGN-branch.md) · [Slice](DESIGN-slice.md) · [Plan](DESIGN-plan.md)

## Contents

| § | section | answers |
|---|---|---|
| 1 | [What an Agent is](#1-what-an-agent-is) | the participant, not the process |
| 2 | [Posture](#2-posture) | none — it is local |
| 3 | [The domain object](#3-the-domain-object) | **the normative spec** |
| 4 | [Lifecycle](#4-lifecycle) | eight states, three models |
| 5 | [Direction](#5-direction) | none |
| 6 | [Relations](#6-relations) | Worktree · Branch · Slice · Person |
| 7 | [Actions](#7-actions) | dispatch · restart · stop · rescue |
| 8 | [Scope](#8-scope) | which agents are the fleet's |
| 9 | [The collaborators](#9-the-collaborators) | a Registry that owns, a Monitor that watches |
| 10 | [Fleet control](#10-fleet-control) | the entity the story is about |
| 11 | [Views](#11-views) | the WORKING section |
| 12 | [Setup](#12-setup) | `Agent registry`, `Worker command` |
| 13 | [Gaps](#13-gaps) | |
| 14 | [Invariants and open points](#14-invariants-and-open-points) | |

---

## 1. What an Agent is

**An Agent is a participant in the fleet: something with an identity that
outlives the branch it is working on.**

`registry.ts` states the distinction the type exists for:

> *"**A branch is what an agent is working on, never what it is.** An agent
> finishes one branch and takes another, and every fact the board held about it
> before this — `.plot-worker.pid` inside a worktree, a transcript directory
> derived from that worktree's path — belongs to the worktree rather than to the
> agent, so it is lost the moment the agent moves on."*

**So `branch` is optional and empty is a real value** — *"the states that matter
most are the ones no worktree can express: an agent between branches, and an
agent that stopped to ask."*

### The unit of work is a Slice

**An agent's unit of work is one slice**, and the fleet's shape follows from it:

```
registry  ──provides──►  agents
agent     ──takes────►   a slice        (its unit of work)
agent     ──owns─────►   a worktree    (its desk, while it lives)
slice merged ─────────►   agent and desk are FREE for the next unit
```

**The code is branch-granular and the model is slice-granular**, and at the
intended shape they coincide: *plan → \* slice → **1** branch* (Slice §8). Where
they diverge — the 21 slices holding several branches — the agent takes a branch
and the slice is not the unit it was meant to be.

### An agent takes a *next* unit, and the loop already does this

**`plot-worker-loop.sh` implements it**: when a unit completes, *"it asks
`--next` for another claimable branch OF THE SAME PLAN, claims it, creates its
worktree, and loops. Exit 1 from `--next` is"* the end of work.

**That is why `branch` is optional** (§3) — an agent between units genuinely
holds none — and it is the mechanism behind *"an agent finishes one branch and
takes another."*

### But the desk does not persist — and that is the divergence

**The model says an agent keeps its worktree; the loop makes a new one per
unit:**

```sh
new_wt="$wt_root/plot-wt-$suffix"
git worktree add -b "$next_branch" "$new_wt" "origin/$main_branch"
```

**So the desk is per-branch, not per-agent.** An agent that completes three
slices creates three worktrees, and the loop removes the previous one *"and tries
`--next` again"* — but only on its own success path.

**That is where the 13 dead trees come from** (§3): each is a desk an agent
abandoned, and nothing outside the loop owns their removal.

#### What the model asks for instead

| | today | the model |
|---|---|---|
| a desk is | **per branch** | **per agent** |
| created | on each unit | **on the agent's first unit** |
| removed | by the loop, on its own success | **by the registry, when the agent ends** |
| reused | never | **for the next unit** |

**Reusing the desk is cheaper and safer**: `git worktree add` costs a full
checkout, and a tree removed on a path the loop does not take is a leak — which
is what 13 of them are.

### The registry's job is the invariant

**Two things it must guarantee**, and neither is enforced today:

> **every agent has a worktree, and no worktree is left behind**

**Measured: 0 manifests, 13 orphaned trees** (§3) — so both halves currently
fail in this estate. The registry knows about agents through manifests; a tree
whose agent is gone and whose manifest was never written is invisible to it, and
`readAgentRegistry` **synthesizes a row** rather than reporting an orphan.

**That is the pairing argument from the other side.** The Worktree spec says the
manifest and the desk are two halves of one thing; this says the **registry** is
what keeps them paired — creating both, and ensuring neither outlives the other.

### Agent and Worker are one entity

**Settled 2026-08-28.** The manifest is its identity card; the pid is its
liveness; the worktree is its desk; the tree and PR are its progress.

**A "worker" is not a separate thing an Agent has — it is the Agent, observed
through the process table.**

**Refined 2026-08-29, without reopening the decision.** *One entity* remains
right; what was missing is which relation the word names:

```
Machine  ──hosts──►  workers      (many; the resource they compete for)
Agent    ──runs───►  one worker   (at a time; its process, while it lives)
Worker   = an Agent's process on a Machine
```

**A Worker is the process an Agent runs on a Machine** — so it names a
*relation*, not a second object, which is why splitting this spec would produce
two descriptions of one thing plus an invented rule for pairing them.

**`elsewhere` is the evidence** ([§4](#4-lifecycle)): it means *no worktree on
this machine*, an agent that exists while its process runs elsewhere. A view of
an agent cannot be somewhere the agent is not; a link can. `machineAtDeath`
(§3) closes the same circle — a worker dies **on** a machine whose state at that
moment is worth recording.

**The practical consequence is vocabulary.** `Worker` belongs to the Machine's
side of the boundary — the six process states, `WorkerActivity`, the
`Worker command` and `Worker bound` keys — and `Agent` to the Registry's:
*registry ──provides──► agents*. **A specialised agent that never becomes a
loop-worker still has a registry entry and simply has no worker**, which is the
case this distinction exists to keep expressible.

### It owns its desk

**The Worktree spec settles the direction** (Worktree §1): the dispatcher creates
the tree, and **the agent owns it**. Every reap refusal is a question about the
agent or what it left behind; none is about the tree itself.

**So the manifest and the worktree are two halves of one thing** — identity and
desk — which is why removing one without the other *"converts a finished
agent"* into an unknown row.

**But the worker is a third thing, with a third lifetime.** Stated
2026-08-29, because "two halves" reads as though the process were one of them:

| | belongs to | lives as long as |
|---|---|---|
| **manifest** | the Registry | the agent is declared |
| **worktree** | the agent — its desk | the slice is unfinished |
| **worker** | the Machine — the process holding the files open | the run |

**The desk outlives the process, and `--stop` proves it**: it *"end[s] a worker;
the tree survives"* (§7). A worker is **the process bracket a Machine needs in
order to edit the files in the desk** — so it starts when work starts, ends when
work stops, and can end several times over one worktree's life (`--restart`
exists for exactly that).

**This is why the reap refusals split cleanly in two**, and the split is not a
coincidence:

- **process questions** — a live pid
- **desk questions** — uncommitted changes, a `PLOT-BLOCKED` marker, a tree on
  the default branch, no merged PR

Four of the five are about what is *on the desk*, not about who is *sitting at
it*, because the desk is what carries unlanded work. **A reaper that only asked
the process question would delete finished work whose author had simply
exited** — which is the accident those four exist to prevent.

---

## 2. Posture

**None.** An Agent is a local process with a local manifest. No tracker knows
one exists, in any posture, and nothing about `Tracker:` changes what it is.

---

## 3. The domain object

> **Identity:** a **minted** — [three kinds](DESIGN-review.md#1-identity-three-kinds),
> and this one fails by *nobody minting*.
> **State:** **DERIVED** — [four sources](DESIGN-review.md#2-state-where-each-entitys-truth-lives),
> going wrong by *staleness*, so the derivation is **re-run every pulse** — a state is a claim about a moment.


### Identity

```
Agent.session : string        the id the dispatcher minted
```

**The session id is the identity, and it is also the transcript's name** — one
string that addresses the agent in the registry, in the manifest filename, and
in its own log.

**Not the branch, not the worktree, not the pid.** Each of those changes while
the agent persists: it finishes one branch and takes another, and a restart
gives it a new pid in the same tree.

### Fields

**From `AgentEntry`, and grouped by which of the four readings answers.**

| field | type | read from | note |
|---|---|---|---|
| `session` | string | manifest | **the identity** — also the transcript's name |
| `identity` **`+`** | `manifest`\|`synthesized` | **manifest presence** | **proposed** — see below |
| `branch` | string | manifest / worktree | `''` between slices is **a real value** |
| `worktree` | path | manifest / `git worktree list` | its desk |
| `command` | string | manifest | the `Worker command` as launched, verbatim |
| `startedAt` | ISO-8601 | manifest | launch moment |
| `pid` | string | manifest | a launch fact — **never alone means running** |
| `previousPid` | string | manifest | what this run displaced; `''` on a first dispatch |
| `relaunches` | number | manifest | how often this desk's worker was relaunched |
| `state` | 8 values | pid + exit + tree | **the process** — see §4 |
| `isFree` **`+`** | bool | `state` + its slice | **proposed** — can it take a unit (§4) |
| `activity` | `working`\|`idle`\|`''` | descendant CPU | **a cue on `running` only** |
| `exitCode` | number \| null | `.plot-worker.exit` | recorded, never inferred |
| `dirtyPaths` | string[] | the worktree | what a `stalled` agent left |
| `machineAtDeath` **`+`** | headroom \| `unmeasured` | Machine at exit | **proposed** — entities §2 |
| `model` | string? | transcript | absent when unreadable — **never guessed** |
| `contextTokens` | number? | transcript | as above |
| `lastActivity` | ISO-8601? | transcript | as above |

### The identity defect, measured at 100%

**A worktree with no manifest is *synthesized* into an entry.**

**Measured 2026-08-28: 0 manifests, 13 dispatch worktrees, and 0 of the 13 hold
a live worker.** The registry directory `.plot/agents/` exists and is **empty**,
so **every agent row this estate renders is synthesized.**

**The 13 are finished agents' leftovers**, not running ones — so the honest
reading is *these desks outlived their agents*, and whether their manifests were
cleaned up with them or never written is not distinguishable from here.

**Which makes it two findings, not one:**

| | |
|---|---|
| **the registry is empty** | every row is synthesized, and none can say so |
| **13 reapable trees remain** | the Worktree spec's missing Manager, as accumulated debris |

**A synthesized entry is not a kind of Agent — it is an Agent whose identity was
never written**, and the row cannot say so. The registry reports the count
(`synthesizedCount`), but a reader looking at one row cannot tell *I know who
this is* from *I inferred that someone is here*.

**Two hardening PRs (#488, #422) fixed where manifests are written** — the
dispatcher's directory resolution and the board's drop path — and neither made
an absent manifest legible **at the row**.

**`identity` is the proposed field**, and it is Issue's `IssueAnswer` shape
applied to identity: *could the source be asked*, kept apart from *what it
said*.

---

## 4. Lifecycle

### Eight states — and three models that disagree

| model | where | states |
|---|---|---|
| `plot-worker-state.sh` | shell, **sourced** | **8** — 6 process + 2 task |
| `WorkerStateSchema` | contract | **8** — matches the shell |
| `AgentState` | `registry.ts` | **5** — keeps 4, collapses the rest |

**The registry collapses at `registry.ts:533`**, and documents it honestly:
`none`, `ended`, `failed` and `elsewhere` are *"not a state the registry claims
to understand"*.

**But that discards the distinction that costs most.** *"`failed` and `finished`
are opposite actions — restart versus review"*, and collapsing `failed` into
`unknown` means the board cannot tell a worker that needs restarting from one
whose state could not be read.

**`plot-dispatch.sh --restart` had to compensate**: it asks the PR **before**
the state word, because *"five of five `failed` worktrees measured here held a
PR (four open, one merged)"* — so a gate on the state alone would have restarted
all five and destroyed what the `finished` refusal protects.

### The eight

| state | means | what a reader may do |
|---|---|---|
| `running` | the pid answers | leave it alone |
| `waiting` | exited, `PLOT-BLOCKED` in the tree | **a person owes it an answer** |
| `stalled` | exited 0, uncommitted or unpushed work, no PR | rescue the tree, then review |
| `finished` | exited 0, nothing left behind | review the PR |
| `failed` | a recorded non-zero exit | restart — **but ask the PR first** |
| `ended` | exited, no record of how | investigate |
| `none` | a worktree exists, no worker ever ran | dispatchable |
| `elsewhere` | **no worktree on this machine** | not answerable here |

### Which of the eight belong to the Worker, and which to the Agent

**Stated 2026-08-29, and it follows from the three lifetimes above.** The enum
carries two kinds of answer, and the source decides which:

| state | read from | belongs to |
|---|---|---|
| `running` | the pid answers | **Worker** — the process |
| `failed` | a recorded non-zero exit | **Worker** |
| `ended` | exited, no record of how | **Worker** |
| `none` | no worker ever ran | **Worker** — its absence |
| `finished` | exited 0 **and** the desk is clear | Worker, **refined by the desk** |
| `waiting` | a `PLOT-BLOCKED` marker **in the tree** | **Agent** — it owes an answer |
| `stalled` | uncommitted or unpushed work **in the tree** | **Agent** — its work is unlanded |
| `elsewhere` | no worktree **on this machine** | neither — a *Machine* answer |

**`waiting` and `stalled` are workflow states, and the code says so.**
`plot-worker-state.sh:46` decides both from the TREE — *"a blocked marker in the
tree → waiting"*, *"uncommitted or unpushed work → stalled"* — never from the
process. An exited process is a precondition for reading them, not the reason
they hold.

**That is why they had to be added at all.** Measured across seven worktrees:
*every* worker exited 0 — the one that opened its PR, the one that stopped
because it would not claim a test run it had not seen, and the one that stopped
to ask about retry semantics. **A process-only vocabulary called all three
`finished`.** Two of the three needed an answer, not a review.

**And it explains why `failed`, `ended` and `none` are deliberately NOT refined
by the tree**: they are Worker facts, and a desk cannot soften a recorded
non-zero exit.

**`elsewhere` belongs to neither.** It is the Machine's answer — *this agent's
worker is not here* — and the reason the earlier "a worker is the agent seen
through the process table" reading was too weak.

### Why the exit code cannot answer "is the task done?"

**Measured across seven worktrees during a four-agent run:** *"EVERY worker
exited 0 — the one that opened its PR and reported cleanly, the one that stopped
because it would not claim a test run it had not seen, and the one that stopped
to ask which retry semantics were wanted. All three landed on `finished`, whose
documented meaning is *review it*. Two of the three needed an answer, not a
review."*

**So `finished` is refined by the TREE**, which is where the difference lives —
and `failed`, `ended` and `none` are deliberately **not** refined: a recorded
non-zero exit is a fact the tree cannot soften.

### The process states do not say whether an agent is *free*

**Eight states answer *what is the worker doing*. The registry's model (§1) asks
a different question: *is this agent available for the next unit of work?*** —
and no state answers it.

| | asks | answered by |
|---|---|---|
| `state` | what is the **process** doing | the pid, the exit code, the tree |
| **availability** | can this agent **take a slice** | the state **plus its slice** |

**They come apart in both directions:**

- **`running` is not "busy".** An agent between units — one that finished a slice
  and is asking `--next` — is `running` and has no branch. It is available.
- **`finished` is not "free".** Its worker exited; under the model the agent and
  its desk *become* free (§1), but nothing marks the transition, and today the
  desk is abandoned instead (§1's divergence).

**So `free` is derived, not stored** — the same shape as a Slice's verdict:

```
agent.isFree = state is live
             ∧ its slice has merged (or it holds none)
```

#### The board already collapses eight into two, for a different question

`LIVE_STATES = { running, waiting }` — and the denylist reading is deliberate:
everything else is not live. **But that is occupancy, not availability.** A
`waiting` agent is live and blocked on a person; it occupies a slot and can take
nothing.

**Which is why `liveAgentCount` is the right denominator for the cap** (§10) and
the wrong answer to *who can take this slice*.

#### Three questions, three answers

| question | answer |
|---|---|
| what is this worker doing? | **`state`** — eight values |
| does it hold a machine? | **live** — `running` \| `waiting` |
| can it take work? | **free** — **unmodelled** |

**The third is what the registry needs to place a slice**, and it is the one
nothing computes.

### `activity` is a cue, never a ninth state

`working` \| `idle` \| `''`, on `running` only. **The discriminator is the
child's CPU, not the shell's**, because the loop shell waits on its child and
burns near-zero CPU in every case.

**Measured 2026-08-25:** `running` covered *"a worker mid-thought, a worker
between slices, and a worker whose child had crashed hours earlier while the loop
waited on it, with **11 of 13** in that last, worst case."*

---

## 5. Direction

**None.** Nothing outside the repo creates or observes an Agent.

---

## 6. Relations

| relation | mechanism | state |
|---|---|---|
| **Agent → Worktree** | the manifest | **built** — the agent owns its desk |
| Agent → Branch | the manifest, or the tree's checkout | **built** — and **optional** |
| Agent → Slice | via its branch | derived |
| Agent → Person | **none** | — |

**An Agent is not a Person** (entities §1c): a Person is a human a record names;
an Agent is a process. They meet only in a transition record's `who`, and an
agent acting on a person's behalf records **the person**.

---

## 7. Actions

| action | who | what |
|---|---|---|
| **Dispatch** | `plot-dispatch.sh` | a desk, a claim, and a worker |
| **Restart** | `--restart <branch>` | a new worker in **the same tree** |
| **Stop** | `--stop` | end a worker; the tree survives |
| **Rescue** | **a person** | commit a stalled agent's tree before killing it |

**`--restart` is the counterpart to `--stop`**, and it does the one thing a slug
dispatch never can: *"it hands a branch that ALREADY holds a claim to a new
worker… because `--next` offers only `open` branches and that lock does not
move."*

**The branch is explicit and never auto-selected** — *"replacing a stopped
worker rather than reviewing, reaping or abandoning its work is a person's
call."*

**And there is no `--force`:** the tree is inherited untouched, because *"a
stall IS uncommitted work, and one measured here left 324 finished lines on the
floor."*

---

## 8. Scope

**Which agents are the fleet's is answered by the registry, and the registry is
two sources joined:** manifests in `Agent registry`, plus worktrees with no
manifest, synthesized.

**Liveness is resolved in one batch per pulse**, never one call per entry —
*"the registry is re-read on the scan's 5 s timer and a fork per agent would put
the scan's cost back."*

---

## 9. The collaborators

**Two, and the split is the same one Worktree has** (Worktree §9): a thing that
**owns**, and a thing that **watches**.

### `AgentRegistry` — owns and controls every agent

**Settled 2026-08-28: all agents are owned and controlled by the registry.** It
provides them, places work on them, and guarantees the pairing (§1):

> **every agent has a worktree, and no worktree is left behind**

#### What exists is a reader, not an owner

**`readAgentRegistry` only reads** — the name says so, and it is a pure function
over a directory: manifests in, entries out, worktrees with no manifest
synthesized.

**`start_worker` is what actually creates an agent**, and it lives in
`plot-dispatch.sh` at two call sites (the fan-out and `--restart`).

**So ownership is scattered across the dispatcher**, and that is why the
registry cannot enforce its own invariants: **it never created anything to
enforce them on.** It is the `WorktreeManager` finding one entity over, and the
two are the same missing object seen from two sides — the registry that owns an
agent is the thing that would give it a desk.

#### What the Registry owns

| | |
|---|---|
| **provide** | a bounded number of agents (`parallelAgents`, entities §Elastic) |
| **place** | a slice onto a free agent (§4 — `free`, currently unmodelled) |
| **pair** | a desk with every agent, and neither outliving the other |
| **retire** | an agent whose work is done, with its desk |
| **attach** | a monitor, at creation |

**Not the states themselves.** `plot-worker-state.sh` stays *"the ONE answer to
is a worker running"*; the registry asks it rather than re-deriving.

### `AgentMonitor` — watches one agent, reports to two consumers

**The registry attaches a monitor to every agent it creates**, and the monitor
reports to **the master agent and the board**.

#### Attached at creation, not polled from a roster

**That is the design decision**, and it buys what a scan cannot have:

| | a scan over the roster | **a monitor attached at creation** |
|---|---|---|
| knows the agent started | infers it from a manifest | **witnessed it** |
| knows what it was given | reads a branch field | **holds the assignment** |
| notices a death | on the next pulse | **at the exit** |
| costs | a pass over every agent | **one watch per agent** |

**And it makes `machineAtDeath` possible** (§3). A scan finding a dead worker
cannot know what the machine was like when it died; a monitor present at the
exit can read it then — which is the fix for all seven `exit 124` deaths in the
story's session being read as agent failure.

#### What it reports

| to the **master agent** | to the **board** |
|---|---|
| *is that worker working, or just alive?* (job 2) | the WORKING row's state and activity |
| a death, with the machine's state at it | a row that stops being live |
| *what changed since I looked?* (job 3) | the change marks |

**Job 3 is the one only a monitor can answer.** The scan is stateless by
design — *"re-derived from git refs every run"* — so a delta needs something
that was present for both moments, and an attached monitor is.

#### What it must not become

**Not a poll per agent.** Thirteen monitors each shelling out per second is the
load the Machine entity exists to protect against, and *"liveness is resolved in
one batch per pulse"* (§8) remains the rule for the roster.

**A monitor watches its own agent** — it knows the pid it was given, so it can
wait on it rather than scanning for it, and the batch stays the registry's job.

## 10. Fleet control

**Agent is the entity the story is about**, and its jobs land here:

| story job | the Agent question |
|---|---|
| **2** — is that worker working, or just alive? | `state` + `activity` |
| **1** — can I start work? | how many agents are live (§8) |
| **4** — what is safe to run? | what an agent's own load costs |

**`liveAgentCount` is the concurrency denominator**, and its rule is measured:
*"a live agent ALWAYS occupies a slot, even if its branch has already merged…
eleven workers whose branches had merged sat at zero CPU for up to ten hours,
none counted against the cap."*

**What the state model still cannot say** is whether a machine was too slow for
the agent to finish — all seven `exit 124` deaths in the story's session were
that, read as agent failure. `machineAtDeath` (§3) is the proposed fix.

---

## 11. Views

| view | shows |
|---|---|
| the **WORKING** section | one row per **registry** agent |
| a branch row's `worker_*` | the agent, projected onto its branch |

**WORKING renders registry agents, not branch rows** — and it is filtered to
`LIVE_STATES`, so a finished agent leaves the section rather than accumulating.

**The `worker_*` fields on a branch row are Agent data on a Branch** (Branch §3)
— the duplication the entities doc argues should become `branch.agent`.

---

## 12. Setup

| key | default | note |
|---|---|---|
| `Agent registry` | `.plot/agents` | **where manifests are written and read** |
| `Worker command` | — | what a dispatched agent runs |
| `Worker bound` | 3600 | the loop's own timeout |

**`Agent registry` exists because a shared checkout needs one place** — the
board may be served from a different worktree than the dispatcher writes to.

---

## 13. Gaps

| # | gap | reachable |
|---|---|---|
| 1 | **Every agent row here is synthesized** — 0 manifests, 13 worktrees, 0 live | **now, measured** |
| 2 | **A synthesized row cannot say so** — no `identity` field | now |
| 3 | **The registry collapses 8 states to 5** — `failed` becomes `unknown` | now |
| 4 | **No `machineAtDeath`** — `exit 124` reads as agent failure | now |
| 5 | `worker_*` duplicated onto branch rows | now |
| 6 | **The desk is per branch, not per agent** — an agent creates a new worktree per unit and removes the old one only on its own success path | **now, measured** |
| 6b | **No agent state says *free*** — eight describe the process, none says whether it can take a slice | **now** |
| 7 | **The registry enforces neither invariant** — not *every agent has a worktree*, nor *no worktree is left behind* | **now, measured** |
| 8 | **The registry only READS** — `readAgentRegistry` is a pure function over a directory, while `start_worker` in `plot-dispatch.sh` creates agents | **now** |
| 9 | **No `AgentMonitor`** — nothing is attached at creation, so a death is noticed on the next pulse and `machineAtDeath` is unknowable | **now** |

**Gap 1 is the sharpest measurement in this document**, and it is two problems
wearing one symptom. The registry directory exists and is empty; 13 dispatched
worktrees remain, **none of them live**. So every row the board renders is
synthesized — and separately, thirteen desks have outlived their agents with
nothing reaping them (Worktree §13).

---

## 14. Invariants and open points

### Invariants

1. **A branch is what an agent works on, never what it is.**
2. **The session id is the identity** — not the branch, the pid or the tree.
3. **A pid alone never means `running`.**
4. **The exit code cannot say whether the task is done** — the tree can.
5. **`failed` never means restartable on its own** — ask the PR first.
6. **`activity` is a cue on `running`, never a ninth state.**
7. **Liveness is resolved in one batch per pulse.**
8. **A synthesized entry is a defect, not a category.**
9. **An agent's unit of work is a slice**, and it is free for the next one once
   that slice has merged.
10. **The registry guarantees the pairing** — every agent has a desk, and no
   desk outlives its agent.
11. **Every agent gets a monitor at creation**, and it reports to the master
   agent and the board.

### Open points

- **Were manifests written for these 13 and cleaned up, or never written?** The
  directory is empty and all 13 agents are gone, so the estate cannot say —
  which is itself an argument for the manifest outliving the run.
- **Should the registry stop collapsing?** The shell and the contract agree on
  eight; only the registry disagrees.
- **Should a desk be reused across units?** The loop creates one per branch;
  the model says one per agent, which is cheaper and leaks less.
