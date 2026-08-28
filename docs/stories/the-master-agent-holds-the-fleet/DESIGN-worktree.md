---
title: Worktree — domain object specification
story: the-master-agent-holds-the-fleet
author: jwloka
status: draft
created: 2026-08-28
updated: 2026-08-28
---

# Worktree — domain object specification

A desk: where one agent works on one branch, and the only entity that is
physical.

> **Story:** [The master agent holds the fleet](STORY-the-master-agent-holds-the-fleet.md)
>
> **Companions:** [Entities](DESIGN-entities.md) · [Branch](DESIGN-branch.md) ·
> [Wave](DESIGN-wave.md) · [Plan](DESIGN-plan.md)

## Contents

| § | section | answers |
|---|---|---|
| 1 | [What a Worktree is](#1-what-a-worktree-is) | the agent's desk, and why it is a measurement |
| 2 | [Posture](#2-posture) | none — it is local |
| 3 | [The domain object](#3-the-domain-object) | **the normative spec** |
| 4 | [Lifecycle](#4-lifecycle) | created, occupied, reapable |
| 5 | [Direction](#5-direction) | none |
| 6 | [Relations](#6-relations) | Branch · Agent · Plan |
| 7 | [Actions](#7-actions) | dispatch · migrate · reap |
| 8 | [Scope](#8-scope) | which trees are Plot's |
| 9 | [The collaborators](#9-the-collaborators) | a Manager and a Monitor, both missing |
| 10 | [Fleet control](#10-fleet-control) | the five refusals |
| 11 | [Views](#11-views) | the agent row's place |
| 12 | [Setup](#12-setup) | `Worktree root` |
| 13 | [Gaps](#13-gaps) | |
| 14 | [Invariants and open points](#14-invariants-and-open-points) | |

---

## 1. What a Worktree is

**A Worktree is a desk: one checkout, one branch, one agent.**

It is the fleet's unit of *isolation* — the reason several agents can work at
once without touching each other's files — and the only entity in this design
that exists as **bytes on a disk** rather than as a record, a ref or a
derivation.

### It belongs to an agent — the ownership runs that way

**Settled 2026-08-28.** An earlier draft modelled `occupant: Agent | null` as a
field *on the tree*, as though a desk might have somebody at it. **The ownership
is the other way round: the worktree is the agent's desk.**

```
Agent ──has──► Worktree          the desk it works at
```

**The dispatcher creates it, the agent owns it.** `plot-dispatch.sh:1908` runs
`git worktree add`, then `start_worker` — so the tree exists a moment before its
agent does, and belongs to it from then on.

**The reap rules prove the direction.** Every one of the five refusals (§10) is
a question about **the agent or what it left behind** — a live pid, uncommitted
changes, a `PLOT-BLOCKED` marker. **None asks anything about the tree itself.**
A worktree is never refused for being a worktree.

**So a tree with no agent is not an unoccupied desk — it is an orphan**, and
that is a different thing to report. §10's fifth refusal exists precisely for
trees Plot did not create and does not own.

**And it explains why the manifest travels with it** (§6): they are two halves
of one thing — the agent's identity and the agent's desk — rather than two
things that happen to sit together. Removing one without the other *"converts a
finished agent"* into an unknown row because it splits a single entity.

### Its existence is a measurement, not a claim

**That physicality is what makes it authoritative.** `plot-dispatch.sh` refuses
a branch whose worktree exists carrying unlanded work, and states why:

> *"A shared file is a **prediction**, but a desk somebody is sitting at is a
> **measurement**."*

**And it is why dispatch alone can see it.** The fleet scan derives from
`origin/<branch>`, so an agent's uncommitted work is invisible to it — *"the
measured failure was two implemented, green branches whose work was never
pushed, so no claim existed and both read `eligible`."*

### It is found, never constructed

**The path is asked of git, never rebuilt from the branch name:**

> *"The worktree is found by asking git which one holds the branch, never by
> rebuilding the path from the branch name: hand-made worktrees are the
> population with no claim ref, and they rarely follow dispatch's naming."*

---

## 2. Posture

**None.** A Worktree is local disk, invisible to every tracker in every posture,
and unpublishable in principle — it is *where* work happens, not the work.

---

## 3. The domain object

### Identity

```
Worktree.path : absolute path
```

**The path is the identity**, and it is the one identity here that is neither a
name nor a number. Two worktrees cannot share a path, and git enforces it.

**The branch is not the identity** — a worktree may hold a detached HEAD, and
one measured here sits on the default branch (§10's fifth refusal).

### Fields

| field | type | source | note |
|---|---|---|---|
| `path` | absolute path | `git worktree list` | **the identity** |
| `branch` | string | `git worktree list` | `''` when detached |
| `isMain` | bool | `git worktree list` | **never reapable** |
| `clean` | bool | `git status` + upstream | **two facts** — see below |
| `agent` | Agent \| null | the manifest / pid | **the owner** — `null` means orphaned, not vacant |
| `prunable` | bool | git | git's own view — **not Plot's** |

### `clean` is two questions

*"**Clean** means two things are BOTH true: no uncommitted changes, and no
unpushed commits."*

**And a tree that cannot be checked returns `false`** — *"the entry stays
visible rather than being silently dropped"*, which is absent-is-not-false
applied to a filesystem.

### `prunable` is git's word, not Plot's

**Measured 2026-08-28: 20 worktrees, several marked `prunable` by git.** That
flag means *the directory is gone*; it says nothing about whether the work
landed, which is Plot's question (§10).

---

## 4. Lifecycle

```
created ──► occupied ──► finished ──► reapable ──► gone
   │                        │
   └── hand-made ───────────┘        (no claim, no manifest)
```

| state | means |
|---|---|
| `created` | `git worktree add` ran; no worker yet |
| `occupied` | an agent's process is alive in it |
| `finished` | the worker exited; the tree may still hold work |
| `reapable` | **all five refusals pass** (§10) |
| `gone` | removed — **the branch and its refs survive** |

**A reap removes a checkout, never history:** *"the branches and refs are
untouched, deliberately: this removes CHECKOUTS, so every reap is re-creatable
with `git worktree add`."*

---

## 5. Direction

**None.** Nothing outside the repo creates or consumes a worktree.

---

## 6. Relations

| relation | mechanism | state |
|---|---|---|
| Worktree → Branch | `git worktree list` | **built** — 1:1 while checked out |
| **Agent → Worktree** | the manifest, and `.plot-worker.pid` | **built** — the agent owns the desk |
| Worktree → Plan | via its branch's wave | derived |

**The manifest goes with the worktree**, and the reason is a measured defect:
*"`readAgentRegistry` renders one row per manifest, so a reap that removes only
the checkout converts a finished agent"* into an unknown row — the estate's own
*deleting a manifest creates an unknown row* finding, from the other side.

---

## 7. Actions

| action | who | what |
|---|---|---|
| **Dispatch** | `plot-dispatch.sh` | one worktree + claim + worker per eligible branch |
| **Adopt** | the same, re-run | **idempotent** — adopts rather than duplicates |
| **Restart** | `--restart <branch>` | a new worker in **the same tree**, untouched |
| **Migrate** | `--migrate` | move trees to a new root |
| **Reap** | `plot-reap.sh --yes` | remove a landed checkout |

**`--restart` inherits the tree deliberately:** *"a stall IS uncommitted work,
and one measured here left 324 finished lines on the floor."*

**And `--migrate` refuses on two things separately** — liveness *and* unlanded
work — because *"`plot_worker_state` alone misses a hand-made dirty worktree."*

---

## 8. Scope

**Which trees are Plot's is not answered by their names.** Dispatch names its
worktrees with a prefix, but the reap and the migrate ask git for the list and
then apply the refusals — because hand-made trees *"rarely follow dispatch's
naming"* and are exactly the population with no claim ref.

**Measured: 20 worktrees, 13 dispatched.** The other 7 include the main
checkout, two scratch trees under `/tmp`, and a diagnostic tree — none of them
Plot's to remove, and the fifth refusal is what says so.

---

## 9. The collaborators

**Two are needed and neither exists**, which is why an earlier draft of this
section said *"none — and it is the only entity here that nothing monitors."*
That was an observation, not a design.

### `WorktreeManager` — owns creation and removal

**Measured 2026-08-28: six scripts create or remove worktrees, five different
ways.**

| script | does |
|---|---|
| `plot-dispatch.sh` | `worktree add` per dispatched branch |
| `plot-worker-loop.sh` | **`add` twice** — a worker creates its own next tree |
| `plot-resolve-artifact.sh` | `add` for a repair, two shapes |
| `plot-approve.sh` | `add` + `remove --force \|\| true` — a disposable tree |
| `plot-deliver.sh` | as above |
| `plot-reap.sh` | `remove`, under five refusals |

**Each brings its own creation, cleanup and error handling**, and the
disposable ones remove with `|| true` — **so a leaked tree is silent.**

**There is no one place that knows what trees Plot has made.** That is the
`planSlug` shape again (Plan §13): a property of a thing, re-implemented per
call site because the thing has no object.

#### What the Manager owns

| | |
|---|---|
| **create** | one `add`, one naming rule, one root (§12) |
| **remove** | one path, with the refusals as its precondition |
| **enumerate** | *which trees are Plot's* — today inferred from a prefix |
| **repair** | a `prunable` tree whose directory vanished (§13) |

**Not the refusals themselves.** `plot-reap.sh`'s five measurements stay where
they are — the Manager performs a removal the caller has already earned, and
*"`--dry-run` is the default"* remains the caller's contract.

**And it must not own the disposable trees' policy.** `plot-approve.sh` making
a throwaway checkout to commit a bookkeeping edit is a different act from
dispatching a desk; the Manager gives it one `add`/`remove` pair, not a lifecycle.

### `WorktreeMonitor` — owns the state

**Nothing watches a tree**, and three of the things the fleet most needs to know
live there:

| question | where the answer is | who asks |
|---|---|---|
| is there uncommitted work? | the tree | **only `plot-dispatch.sh`** |
| how long since a write? | the tree — `changed_ago_seconds` | the scan, per pulse |
| is a `PLOT-BLOCKED` marker present? | the tree | the reap, at reap time |

**The scan sees a tree only through the branch row** (Branch §3) — six
`local_*` fields — and it re-derives them every pulse for every branch,
whether or not a tree exists.

#### Why a monitor rather than more scan fields

**The tree changes on a different clock from git.** A ref moves when someone
pushes; a working tree moves **on every keystroke** — which is exactly why
`changed_ago_seconds` exists rather than `local_dirty` alone: *"`local_dirty` is
a SWITCH: it flips once and stays flipped… Measured on the live board: three
modified files, zero flashes in 40 seconds."*

**So the tree is the fleet's fastest-moving surface and its least observed.**
The story's **job 2** — *is that worker working, or just alive?* — is answered
there, and the Wave spec's missing *in progress* verdict (§4 there) is the same
gap seen from above.

#### What it must not become

**Not a filesystem watcher.** An inotify-style watch on 13 trees is a resource
the entities doc's Machine section is about protecting, and the monitor's own
cost would compete with the workers it observes.

**Bounded like the BuildMonitor** (Build §9): it watches **the trees of
branches the fleet owns**, and it stops when a tree's agent is gone — a tree
with no live agent has a state that no longer changes.

## 10. Fleet control

### The five refusals, in the order they run

**Every one is a MEASUREMENT, not a judgement** — *"is a process alive; is the
tree dirty"* — which is what licenses a script to remove files at all.

| # | refusal | why |
|---|---|---|
| 1 | a **live worker** | *"a desk someone is at"* |
| 2 | **uncommitted changes** | *"work that exists nowhere else"* |
| 3 | a **`PLOT-BLOCKED*` marker** | *"a worker waiting on a person"* |
| 4 | **no merged PR** | *"the host is the authority"* |
| 5 | the **main checkout or a non-dispatch tree** | *"not ours to remove"* |

**Refusal 4 reads `mergedAt`, never `state`**, and the reason is measured:
*"squash-merge leaves the branch permanently ahead of main, which is why
ancestry alone cleared **1 of 29** finished trees here and the host cleared the
other 28."*

**Refusal 5 catches a subtle case**: a tree sitting on the default branch has
*"its dispatched branch not checked out, so its state was never measured."*

### `--dry-run` is the default

**Removal happens only under `--yes`**, and `--max N` bounds it. A script that
deletes directories defaults to reporting.

---

## 11. Views

**A Worktree has no row of its own.** It appears as the *place* an agent is —
`local_worktree` on a branch row, and the agent registry's own row.

**Which produced a measured defect:** deleting a manifest while keeping the
checkout *"creates an unknown row"*, because rows are synthesized from
worktrees. **The fix was to reap the worktree, not delete the manifest** (§6).

---

## 12. Setup

**`Worktree root`** — where dispatch puts its trees, and **the intended value is
`.worktrees`, inside the project folder.**

`resolve_wt_root` supports it directly: an **absolute** value is taken as given,
a **relative** one is resolved against the repo root — so `Worktree root:
.worktrees` yields `<repo>/.worktrees/<branch>`.

### The legacy default is beside the repo, not inside it

**Unset, dispatch falls back to the repo's parent** with a `plot-wt-` prefix
*"that existed only to make Plot's worktrees identifiable among the"* siblings.

**Measured here 2026-08-28** — `Worktree root` is unset, so this repo runs the
legacy shape:

| location | trees |
|---|---|
| `…/Agentic-Tools/` (the repo's parent) | **15** |
| scratch dirs under `/tmp` | 4 |
| a job dir | 1 |

**So this estate has not adopted the intended layout**, which is why `--migrate`
exists: *"move legacy worktrees into the configured `Worktree root:`"*, skipping
a busy one with the reason, and dry-run by default.

### Inside the project is a different shape, not just a different path

**Three things change when the trees move inside:**

| | beside the repo | **inside it** |
|---|---|---|
| `git status` in the main checkout | unaffected | **sees `.worktrees/` unless ignored** |
| `git add -A` | cannot reach them | **can** |
| a recursive tool (`rg`, a test runner, `node --watch`) | skips them | **descends into every tree** |

**`.worktrees` is not in this repo's `.gitignore`**, and adopting the layout
without adding it would put every dispatched tree in front of `git status` — in
a repo whose `.gitignore` already carries a warning about exactly this class of
mistake: *"a `git add -A` in a worker's worktree carries someone's console log
into"* the commit.

**The prefix becomes unnecessary.** `plot-wt-` existed to distinguish Plot's
trees from their siblings; inside a dedicated directory, containment does that
job and the names can be the branch names.

---

## 13. Gaps

| # | gap | reachable |
|---|---|---|
| 1 | **No `WorktreeManager`** — six scripts create or remove trees five ways, and the disposable ones remove with `\|\| true`, so a leak is silent | **now, measured** |
| 1b | **No `WorktreeMonitor`** — a tree can go dirty, be abandoned or fill a disk unobserved | now |
| 2 | **`prunable` is git's word, unread by Plot** — a tree whose directory vanished still lists | now |
| 3 | **The fleet scan cannot see uncommitted work** — only dispatch can, and only locally | now |
| 4 | **`.worktrees` is not in `.gitignore`** — adopting the intended in-project layout would expose every dispatched tree to `git status` and `git add -A` | **on adoption** |
| 5 | **This estate runs the legacy layout** — `Worktree root` unset, 15 trees in the repo's parent | now, measured |

**Gap 3 is the story's own job 2** seen from the filesystem: *is that worker
working, or just alive?* is answered by the tree, and the tree is visible to
one script.

---

## 14. Invariants and open points

### Invariants

1. **A worktree belongs to an agent** — it is the agent's desk, not a place an
   agent visits.
2. **A worktree is a measurement**, not a claim — its existence is a fact on
   disk.
3. **The path is the identity**; the branch is not.
4. **Found by asking git**, never by rebuilding a path from a name.
5. **`clean` means two things** — nothing uncommitted *and* nothing unpushed.
6. **Every reap refusal is a measurement**, and there are five.
7. **A reap removes a checkout**; branches and refs survive.
8. **The manifest goes with the worktree** — removing one without the other
   creates an unknown row.
9. **`--dry-run` is the default** for anything that deletes.

### Open points

- **Should a worktree be monitored?** Nothing watches one, and job 2's answer
  lives there.
- **Should `prunable` be read?** Git already knows a tree's directory is gone.
- **Should `/plot-init` propose `Worktree root: .worktrees`?** It is the intended
  layout, it is unset here, and adopting it needs a `.gitignore` line the setup
  step would be the natural place to add.
