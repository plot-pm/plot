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
| 1 | [What a Worktree is](#1-what-a-worktree-is) | the desk, and why it is a measurement |
| 2 | [Posture](#2-posture) | none — it is local |
| 3 | [The domain object](#3-the-domain-object) | **the normative spec** |
| 4 | [Lifecycle](#4-lifecycle) | created, occupied, reapable |
| 5 | [Direction](#5-direction) | none |
| 6 | [Relations](#6-relations) | Branch · Agent · Plan |
| 7 | [Actions](#7-actions) | dispatch · migrate · reap |
| 8 | [Scope](#8-scope) | which trees are Plot's |
| 9 | [The collaborators](#9-the-collaborators) | the only entity nothing monitors |
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
| `occupant` | Agent \| null | the manifest / pid | who is at the desk |
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
| Worktree → Agent | the manifest, and `.plot-worker.pid` | **built** |
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

**None — and it is the only entity here that nothing monitors.**

| | |
|---|---|
| read by | `plot-dispatch.sh`, `plot-reap.sh`, `readAgentRegistry`, the scan |
| monitored by | **nothing** |
| cached | **nothing** |

**`git worktree list` is cheap and local**, so every consumer asks it directly.
That is right, and it is why a Worktree needs no connector, no monitor and no
budget — the opposite end of the spectrum from PR.

---

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

**`Worktree root`** — where dispatch puts its trees. A recent addition; before
it, `plot-dispatch.sh` *"put every worktree in the repo's parent, with a
`plot-wt-` prefix that existed only to make Plot's worktrees identifiable."*

---

## 13. Gaps

| # | gap | reachable |
|---|---|---|
| 1 | **Nothing monitors a worktree** — a tree can go dirty, be abandoned, or fill a disk unobserved | now |
| 2 | **`prunable` is git's word, unread by Plot** — a tree whose directory vanished still lists | now |
| 3 | **The fleet scan cannot see uncommitted work** — only dispatch can, and only locally | now |

**Gap 3 is the story's own job 2** seen from the filesystem: *is that worker
working, or just alive?* is answered by the tree, and the tree is visible to
one script.

---

## 14. Invariants and open points

### Invariants

1. **A worktree is a measurement**, not a claim — its existence is a fact on
   disk.
2. **The path is the identity**; the branch is not.
3. **Found by asking git**, never by rebuilding a path from a name.
4. **`clean` means two things** — nothing uncommitted *and* nothing unpushed.
5. **Every reap refusal is a measurement**, and there are five.
6. **A reap removes a checkout**; branches and refs survive.
7. **The manifest goes with the worktree** — removing one without the other
   creates an unknown row.
8. **`--dry-run` is the default** for anything that deletes.

### Open points

- **Should a worktree be monitored?** Nothing watches one, and job 2's answer
  lives there.
- **Should `prunable` be read?** Git already knows a tree's directory is gone.
