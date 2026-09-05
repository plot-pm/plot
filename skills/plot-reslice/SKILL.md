---
name: plot-reslice
description: >-
  Repair a plan whose wave holds several branches: read the entangled
  branches — their diffs, PRs and conflicts — propose one named wave per
  branch in an argued dependency order, confirm the order with a person,
  then rewrite only that plan's `## Branches` section. Proposes; a person
  confirms. Part of the Plot workflow. Use on /plot-reslice.
globs: []
license: MIT
metadata:
  author: eins78
  repo: https://github.com/plot-pm/plot
  version: 1.0.1
compatibility: Designed for Claude Code and Cursor. Requires git. Host operations (PRs, diffs) go through plot-host.sh (GitHub or Bitbucket).
---

# Plot: Reslice a wave

Slice a wave that holds several branches into one wave per branch, so the
model the manifesto states — *a wave holds exactly one branch* — holds over
a plan that violated it.

**Why it exists.** A wave is the unit of **ordering** and a branch the unit
of **work**, and the manifesto now makes them one-to-one. A `### ` heading
carrying several branch lines has **no single verdict**: five branches under
one heading is a wave that is neither complete nor clearly startable, so *a
wave has one section* is undefined over it. Slicing gives the shape a
well-defined verdict. Whether anyone then builds the branches is a separate
question with a separate answer — this command **does not build them**.

**What it never does.** It does not rename a branch (the names are already
in `## Branches`, and a rename breaks every claim ref pointing at one). It
does not reorder work that has landed (a `complete` wave is history — its
ordering already happened). It does not merge or dispatch (it produces a
sliced plan; `/plot-dispatch` then does what it always does, now one
worktree per wave). And it **writes nothing without confirmation** — the
order is the judgement a person must make, because a wrong order blocks work
that could have run and a missing dependency lets two agents collide.

**Input:** `$ARGUMENTS` = `<slug>` (optional if exactly one plan has a
sliceable wave — propose it).

## Model Guidance

| Steps | Min. Tier | Notes |
|-------|-----------|-------|
| 1. Locate the Plan and the Wave | Small | `plot-plan-meta.sh` reports each wave's branch count; the sliceable wave is a mechanical selection |
| 2. Confirm the Wave Is Sliceable | Small | Branch count > 1 and the wave is not `complete` are both mechanical checks (`plot-fleet-scan.sh` gives the wave verdict) |
| 3. Read the Branches | Frontier | Reading diffs, PRs and conflicts to say what each branch IS — not what it is named — is interpretation, not extraction |
| 4. Propose One Wave per Branch | Frontier | Naming each slice and arguing a dependency order is the judgement this command exists for; a smaller tier proposes the split but asks a person for the names and the order |
| 5. Ask — the order is the part a person owns | Frontier | Present the proposed order with its argument; the order is confirmed, never assumed |
| 6. Rewrite the `## Branches` section | Small | Once the order is confirmed, the edit is mechanical: one `### ` heading per branch, branch lines byte-identical, the rest of the file untouched |
| 7. Commit and orient | Small | One commit on the plan's branch; summary |

> **User interaction:** Use `AskUserQuestion` (Claude Code) / `ask_question` (Cursor) for all proposals and confirmations.
>
> **No user present?** If `PLOT_UNATTENDED=1` is set, do not call the question tool — the question below declares what to do instead, and every skipped question is named in the output. See [Running unattended](../plot/docs/unattended.md).

### 1. Locate the Plan and the Wave

Parse all plans and find the one to reslice:

```bash
../plot/scripts/plot-plan-meta.sh docs/plans/*.md
```

The `waves` array reports each wave's `name` and its `branches`. A
**sliceable wave** is one whose `branches` array has **more than one entry**.

- If `$ARGUMENTS` names a slug, use that plan.
- If no slug is given, list every plan that has a sliceable wave and, if
  there is exactly one, propose it; if there are several, ask which.
- If the named plan has **no** sliceable wave — every wave already holds one
  branch — **stop and say so**. A healthy estate must yield **no proposal**;
  proposing churn on a plan that is already one-branch-per-wave is the defect
  this command must not introduce.

### 2. Confirm the Wave Is Sliceable

Two conditions must both hold before proposing anything. They are the two
kinds of wave this command must leave alone:

- **More than one branch.** A single-branch wave is already the model. (Step
  1 selected on this, but re-state it as the gate it is.)
- **The work has not all landed.** A wave whose branches have **all merged**
  is a *record of how something shipped*, not an instruction about what may
  start — the ordering the rule protects has already happened there, and
  rewriting it re-orders nothing and rewrites history to no reader's benefit.
  Check the wave's verdict:

  ```bash
  ../plot/scripts/plot-fleet-scan.sh <slug>
  ```

  A `complete` wave (every branch merged) is **left untouched** — say so and
  stop. Only a wave with **unlanded work** binds the rule.

> **Smaller models:** you can make both mechanical checks. The moment the
> wave is confirmed sliceable, hand step 3 (reading the branches to name the
> slices) to a person or a larger tier — the split is mechanical, the names
> and the order are not.

### 3. Read the Branches — what each one IS, not what it is named

The slice names should describe **what the work is**, not restate the branch
names. So read each branch in the wave before proposing anything:

- **Its diff.** What files does it touch, and what does it change about them?

  ```bash
  git fetch origin
  git log --oneline "origin/<default-branch>..origin/<branch>"
  git diff --stat "origin/<default-branch>...origin/<branch>"
  ```

- **Its PR.** State (draft/ready/conflicts) and what the PR body says the
  branch is for:

  ```bash
  ../plot/scripts/plot-host.sh pr-state <branch>
  ../plot/scripts/plot-host.sh pr-body <pr-number>
  ```

- **Its conflicts.** Two branches that touch the same files are a
  **dependency signal** — the order must land one before the other, or they
  collide. Note which branches overlap; this is the evidence for the order
  you argue in step 4.

This is the step that distinguishes a reslice from a mechanical rename: a
tool that only counted branches could split the wave, but the *names* and the
*order* come from reading the work.

### 4. Propose One Wave per Branch, in an argued order

Produce a proposal — **do not write it yet**:

- **One `### ` heading per branch**, each naming what that branch is *about*
  (`Gated`, `Marked`, `Fitted` — a word a person would recognise for the
  slice), drawn from the diffs and PRs read in step 3, never from the branch
  name alone.
- **A dependency order** for the waves, argued from the evidence: a branch
  whose diff another branch builds on, or whose files another branch also
  touches, must land first. State the argument, not just the order — "wave B
  reads the field wave A adds, so A precedes B" — because the argument is
  what a person confirms or corrects.
- **The branch names unchanged.** Each branch line keeps its backticked name,
  its description, its `→ #NNN` annotation, and any `<!-- claimed: -->` /
  `<!-- deferred: -->` comment exactly as written. Only the `### ` heading
  above each line is new.

### 5. Ask — the order is the part a person owns

Present the proposed slicing and **ask the person to confirm the order**
before writing. The order is the judgement this command cannot make alone: a
wrong order blocks work that could have run in parallel, and a missing
dependency lets two agents collide on the same files. Offer the argued order,
name the dependencies you inferred, and let the person reorder or rename.

> **Unattended (`PLOT_UNATTENDED=1`):** stop — the order has no safe default,
> and rewriting a plan's `## Branches` section without confirmation would edit
> the one artifact Plot treats as the source of truth. Emit the proposal (the
> slice names and the argued order) so the work is not lost, and **write
> nothing**.
> `PLOT-UNASKED: In what dependency order must these waves land? — stopped — the proposed slicing is printed above; the plan file is untouched`

### 6. Rewrite the `## Branches` section — and only it

Once the order is confirmed, rewrite the plan file's `## Branches` section so
each branch sits under its own `### ` heading, in the confirmed order. The
edit is deliberately surgical:

- **Only the `## Branches` section changes.** Every other section of the plan
  file — `## Status`, `## Problem`, `## Design`, `## Notes`, the
  challenge-the-plan metadata block — is **byte-identical** after the rewrite.
  A rewriter that reformats the whole file passes a test that only counts
  waves and still corrupts the plan; do not reformat.
- **Branch lines are byte-identical.** The backticked branch name, the
  description, the `→ #NNN` PR annotation, and any `<!-- claimed: -->` /
  `<!-- deferred: -->` comment on each line are carried across unchanged.
  Only the `### ` headings above them are added or changed. A reslice that
  renames a branch breaks every claim ref pointing at it.
- **One branch per `### ` heading.** After the rewrite, the wave that held
  several branches is gone; in its place are as many `### ` headings as there
  were branches, each with exactly one branch line.

Verify the surgery before committing:

```bash
# Every other section is untouched — the diff touches ONLY the Branches section.
git diff docs/plans/<plan-file>

# The parser now reports one branch per wave, and the same branch NAMES.
../plot/scripts/plot-plan-meta.sh docs/plans/<plan-file>
```

The `branches` array from the parser must be **identical** (same names, same
count) before and after — the reslice moves branches between waves, it does
not add, drop, or rename any. Only the `waves` array changes: one wave with
N branches becomes N waves with one branch each.

### 7. Commit and orient

Commit the rewrite on the plan's branch (where the plan file lives):

```bash
git add docs/plans/<plan-file>
git commit -m "plot-reslice: slice <slug>'s <wave-name> wave into one wave per branch"
```

Close by orienting: the wave is now N waves, each with one branch and a
well-defined verdict. What falls out next is **not** this command's business
— dispatching or building the branches is a separate decision. If the plan
belongs to a sprint whose rules were undefined over the uncut slice, note
that those rules now hold.

> The reslice is a plan-file edit and nothing more. It does not merge, does
> not dispatch, and does not build the branches. `/plot-dispatch` then does
> what it always does — one worktree per branch, which now means one per
> wave, as the model says.
