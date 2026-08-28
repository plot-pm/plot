---
title: Branch — domain object specification
story: the-master-agent-holds-the-fleet
author: jwloka
status: draft
created: 2026-08-28
updated: 2026-08-28
---

# Branch — domain object specification

A wave's unit of work, and the one entity whose truth is a git ref.

> **Story:** [The master agent holds the fleet](STORY-the-master-agent-holds-the-fleet.md)
>
> **Companions:** [Entities](DESIGN-entities.md) · [Wave](DESIGN-wave.md) ·
> [Plan](DESIGN-plan.md) · [Sprint](DESIGN-sprint.md) ·
> [Story](DESIGN-story.md) · [Issue](DESIGN-issue.md)

## Contents

| § | section | answers |
|---|---|---|
| 1 | [What a Branch is](#1-what-a-branch-is) | the work, and the claim |
| 2 | [Posture](#2-posture) | nothing — a branch is git's |
| 3 | [The domain object](#3-the-domain-object) | **the normative spec** |
| 4 | [Lifecycle](#4-lifecycle) | five states, and the ref that decides |
| 5 | [Direction](#5-direction) | none |
| 6 | [Relations](#6-relations) | Wave · PR · Agent · Worktree |
| 7 | [Actions](#7-actions) | claim · dispatch · merge · defer |
| 8 | [Scope](#8-scope) | which branches are a plan's |
| 9 | [The collaborators](#9-the-collaborators) | the scan, and the fetch it needs |
| 10 | [Fleet control](#10-fleet-control) | the unit everything acts on |
| 11 | [Views](#11-views) | the branch row |
| 12 | [Setup](#12-setup) | `Branch prefixes` |
| 13 | [Gaps](#13-gaps) | |
| 14 | [Invariants and open points](#14-invariants-and-open-points) | |

---

## 1. What a Branch is

**A Branch is one wave's unit of work, and the claim on it.**

Two jobs, and the second is what makes the fleet possible:

- **the work** — a slice small enough for one worker, ending in one PR
- **the claim** — pushing the ref *is* taking the work; no lock manager exists

### The claim is the push

*"The push is the claim, and it is the whole locking mechanism: pushing a ref
that already exists is rejected, so two sessions racing for the same branch
cannot both win."*

**That is the fleet's entire concurrency control**, and it is worth stating
plainly: no database, no lease, no coordinator. Git's own refusal to
fast-forward a diverged ref is what stops two agents doing one job.

**The loser is not blocked** — it asks `--next` again and takes another branch.

### Its truth is a ref, not a file

**A Branch is the only entity here whose source is git itself.** A Plan is a
file, a Story is a file, an Issue is a tracker's answer, a Wave is computed —
a Branch *is* `refs/remotes/origin/<name>`, and everything else about it is read
from that.

The plan file names it, and that naming is a **declaration of intent**. Whether
the branch exists, holds work, or has merged is git's answer and never the
plan's.

---

## 2. Posture

**No posture changes what a Branch is.** Like a Wave, it has no representation
outside the repo — but for a different reason: a wave is *unpublishable* (it is
a gate, §2 there), while a branch is simply **git's, not Plot's**.

**A tracker never sees branches**; it sees the PR a branch produced. So under
publishing, the branch is the thing the feature ticket is *about* and never the
thing published.

---

## 3. The domain object

### Identity

```
Branch.name : string        e.g. feature/a-branch-with-work-is-seen
```

**The ref name is the identity, and it is repo-global** — unlike a Wave, whose
name means nothing outside its plan. That is what lets a claim work: two plans
naming one branch is a *collision*, and the scan reports it as
`double-claimed`.

### Fields

`FleetBranchSchema` carries 21. They divide by **who answers**:

| from git | from the plan | from the local disk | from the agent |
|---|---|---|---|
| `state`, `held`, `ref_held`, `local_ahead` | `deferred`, `deferred_reason`, `claimed` | `local_dirty`, `local_locked`, `local_worktree`, `changed_ago_seconds`, `changed_at`, `changed_paths` | `worker`, `worker_pid`, `worker_exit`, `worker_dirty_paths`, `worker_activity` |
| `conflicts`, `conflicts_known` | | | |

**The five `worker_*` fields are Agent data on a Branch row** — the duplication
the entities doc measures (`AgentRow` and `FleetBranch` share four fields). On
the domain object they become `branch.agent`, and the row derives what it
renders.

### Two fields that look like one

**`claimed` and `ref_held` answer the same question from different sources**, and
the contract is explicit about which wins:

> *"The plan's `<!-- claimed: -->` annotation is a reflection for humans and the
> board; where the two disagree, **git wins**."*

`claimed` is a note a human or agent wrote into the plan; `ref_held` is whether
the ref exists. **Keeping both is right** — the annotation says *who and when*,
which git cannot — but a consumer must never read `claimed` as the claim.

### `conflicts` needs `conflicts_known`

*"Empty means nothing on its own. Read it only beside `conflicts_known`."*

The same askability split Issue uses: **an empty conflict set and an unasked
question are different answers**, and merging them would report a clean merge
that was never attempted.

---

## 4. Lifecycle

### Five states

| state | rule | means |
|---|---|---|
| *(no ref)* | — | nobody has claimed it |
| `claimed` | `ahead > 0`, `real == 0` | a ref was pushed, **carrying no real work yet** |
| `wip` | `ahead > 0`, `real > 0` | **the ref holds commits the default branch lacks** |
| `merged` | `ahead == 0` | its work is in the default branch |
| `deferred` | from the **plan** | the plan said not to build it |

#### `wip` is about commits, not about anyone working

**The name misleads, and the rule is precise.** `wip` says *this ref carries
real commits that `main` does not* — nothing about an agent, a worktree, or
uncommitted changes.

So the pair `claimed` / `wip` splits one question: **has any real work landed on
the ref?** `claimed` is *someone pushed it*; `wip` is *and there are commits*.

**Three neighbouring things are what the name suggests, and each lives
elsewhere:**

| the question | the field |
|---|---|
| is the working tree dirty? | `local_dirty`, `changed_ago_seconds` — read from the **worktree** |
| is an agent working on it? | `worker`, `worker_activity` — the **Agent** |
| is this wave under way? | **nothing** — the gap the Wave spec records (§4 there) |

**`local_dirty` is deliberately one-directional**: it *"may only LIFT a branch
out of quiet, never downgrade an answer"* — because on a machine with no
worktree for the branch it is false, which must change nothing.

#### `deferred` is the odd one

It comes from the **plan**, not from git. A deferred branch may not exist at
all, and the delivery gate exempts it — *"the deferred ones are exempt"*.

#### The `wip` rule has a measured failure

**A squash-merge that resurrects the ref reads `wip` forever.** The host deletes
the branch on merge, a worktree that still holds it pushes it back, and the
squash rewrote the commits — so `ahead > 0` and `real > 0` against work that
has **already landed**.

Measured 2026-08-23: `bug/done-holds-finished-plans-only`, **PR #356 merged, read
`wip` for three hours.** Its wave reported *"3 merged, the rest not yet"* over
four merged branches and never completed, so the plan sat in Development with
nothing left to do.

**That is the same squash-merge trap the estate keeps hitting** — `mergedAt`
outranks ancestry, recorded in `plot-reap.sh` and in the PR entity — arriving
here through the branch classifier rather than through a PR state.

### The state is only as fresh as the last fetch

**Measured 2026-08-28, and it caught me while writing the Wave spec.** The same
scan, seconds apart:

| | `merged` | `open` |
|---|---|---|
| with fetch | **43** | 5 |
| `--no-fetch` | **0** | **48** |

Three sampled `open` branches were PRs #490, #492 and #494 — **all merged that
day.**

The scan documents exactly this: *"the fetch also PRUNES remote-tracking refs,
so skipping it keeps whatever stale refs this checkout holds; a branch merged
and deleted upstream may read `wip` rather than `merged`."*

**So a Branch's state is a claim about a moment**, and the moment is the last
fetch. That is the one entity property here that decays without anyone touching
anything — a Plan's state is wrong only if someone edits the file.

**And the scan says so in its footer:** `merge_detect=pr-merge|truncated|none`.
A consumer that reads the states and not the footer is reading a snapshot
without its timestamp — which is precisely the mistake made one document over.

---

## 5. Direction

**None.** A branch is never inbound or outbound: nothing outside the repo
creates one, and nothing publishes one. It is git's, and the tracker sees only
its PR (§2).

---

## 6. Relations

| relation | mechanism | state |
|---|---|---|
| Wave → Branch | `(Branch: x)` in the heading | **built** — the wave owns it |
| Branch → PR | `→ #N` / `PR: #N` | **built, but flattened** in the record |
| Branch → Agent | a worker in its worktree | **built** — via `worker_*` |
| Branch → Worktree | `git worktree list` | **built** — `local_worktree` |

**A branch belongs to exactly one wave**, and two plans naming it is the
`double-claimed` defect — *"the same shape as `conflict` one level up: that one
is two branches disagreeing about a file, this is two plans disagreeing about a
branch."*

---

## 7. Actions

| action | who | what |
|---|---|---|
| **Claim** | `git push -u origin <branch>` | **the claim itself** |
| **Dispatch** | `plot-dispatch.sh` | a worktree + a worker |
| **Restart** | `--restart <branch>` | hand a claimed branch to a new worker |
| **Defer** | annotate the plan | exempt it from the gate |
| **Merge** | a human, via the host | what makes it `merged` |
| **Reap** | `plot-reap.sh` | remove a landed branch's worktree |

**Plot never merges.** `plot-merge-queue.sh` computes order and predicts
collisions; a person merges. And **giving a branch up never deletes the ref** —
*"never delete a remote ref another session may be reading"*; the plan is
annotated instead.

---

## 8. Scope

**A branch is a plan's if a wave names it.** The scan reads plans, collects
branch names, and asks git about each — so a ref that no plan names is invisible
to the fleet, however much work it holds.

**That is deliberate**, and it is why `plot-dispatch.sh` reports which other
branches hold which files *from local refs and worktrees*: unpushed work belongs
to no plan and would otherwise be unseeable.

---

## 9. The collaborators

**One, and it needs a network call to be right:** `plot-fleet-scan.sh`.

| flag | trades |
|---|---|
| *(default)* | fetches — correct, ~18 s |
| `--no-fetch` / `--offline` | **stale refs**, fast, footer says so |
| `--loose` | pushed counts as landed; refused where unverifiable |

**The staleness is honest rather than hidden** — the footer names the detection
mode, and `--offline` is documented as *"the honest answer for a scan that asked
nothing."*

---

## 10. Fleet control

**The Branch is the unit everything acts on**, and the tooling is the densest
here:

| capability | script |
|---|---|
| state, claim, worker | `plot-fleet-scan.sh` |
| one claimable branch | `--next` |
| dispatch / restart / stop | `plot-dispatch.sh` |
| merge order + collisions | `plot-merge-queue.sh` |
| reap a landed worktree | `plot-reap.sh` |
| PR state per branch | `plot-impl-status.sh` |

---

## 11. Views

| view | shows |
|---|---|
| branch row | name, state, worker, PR, age, marks |

**It is the board's densest row**, carrying the branch, its agent, its PR and
its worktree — which is exactly the duplication the entities doc argues should
become references.

---

## 12. Setup

**`Branch prefixes`** — `idea/, feature/, bug/, docs/, infra/` by default. It
decides what parses as a branch name in a plan, which is why an `idea/` line
under `## Branches` parses at all (Plan §6).

---

## 13. Gaps

| # | gap | reachable |
|---|---|---|
| 1 | **State decays without a fetch** — 43 merged read as 0, measured | **now** |
| 2 | **Five `worker_*` fields are Agent data on a Branch row** | now |
| 3 | **`claimed` and `ref_held` both look like the claim** — only one is | now |
| 4 | Branch → PR is flattened in the plan record (Plan §4) | now |
| 5 | **`wip` names commits, not work-in-progress** — and a resurrected ref after a squash merge reads `wip` indefinitely, measured at 3 hours | now |

---

## 14. Invariants and open points

### Invariants

1. **The push is the claim** — there is no other locking mechanism.
2. **Git wins over the plan's annotation**, always.
3. **A branch's state is as fresh as the last fetch**, and the footer says so.
4. **`conflicts` is meaningless without `conflicts_known`.**
5. **Plot never merges and never deletes a remote ref.**
6. **A branch belongs to one wave**; two plans naming it is `double-claimed`.
7. **`deferred` comes from the plan, not from git.**

### Open points

- **Should the state carry its own freshness?** The footer says how it was
  detected; a consumer reading one branch does not see the footer.
- **Should `worker_*` become `branch.agent`?** The entities doc argues yes.
