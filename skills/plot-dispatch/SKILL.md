---
name: plot-dispatch
description: >-
  Fan out an approved plan's eligible branches: one git worktree and one
  detached worker per branch, each claimed atomically. The writing half of
  the fleet. Use on /plot-dispatch.
globs: []
license: MIT
metadata:
  author: eins78
  repo: https://github.com/plot-pm/plot
  version: 0.1.0
compatibility: >-
  Designed for Claude Code and Cursor. Requires git with worktree support and
  python3. Starting workers needs a `Worker command` in Plot Config; without
  one, worktrees are prepared and you start them yourself.
---

# Plot: Dispatch

Turn one approved plan into several agents working at once — one git worktree
and one detached worker per eligible branch, each branch claimed atomically so
no two sessions collide.

This is the **writing** half of the fleet; `/plot-fleet` is the reading half.
They never talk to each other: the pulse reports what is eligible, a human
decides to dispatch it. That separation is what makes the whole thing
restartable — kill anything, and the next pulse re-derives the truth from git.

**Fanning out is human-paced** (Manifesto, Pacing). It commits scope: several
agents, several branches, real tokens. Monitoring is automatable; committing to
parallel work is a decision. This command therefore never runs itself, and
`--dry-run` exists so the decision can be taken with the facts in hand.

**Input:** `$ARGUMENTS` = `[--dry-run] [--no-start] [--max N] <slug>`.

## Model Guidance

| Steps | Min. Tier | Notes |
|-------|-----------|-------|
| 1. Preflight | Small | Phase check + one script call |
| 2. Dry run and confirm | Mid | How many agents is a judgment about cost and review capacity |
| 3. Fan out | Small | The script does the work; claims are atomic |
| 4. Report | Small | Read the footer counts |

> **User interaction:** Use `AskUserQuestion` (Claude Code) / `ask_question` (Cursor).

## Steps

### 1. Preflight

The plan must be **Approved** and its `Impl:` answer must be `own branches` —
fan-out is meaningless for a same-branch or other-repo plan. Read both with
`../plot/scripts/plot-plan-meta.sh`.

Then look before leaping:

```bash
../plot/scripts/plot-fleet-scan.sh <slug>
```

If the wave is blocked, stop and say why: an earlier wave still has unmerged
work, and dispatching would build on a seam that has not been proven.

### 2. Dry Run, Then Confirm

**Always dry-run first, and show the user the result before fanning out:**

```bash
../plot/scripts/plot-dispatch.sh --dry-run <slug>
```

Then ask how many to start. Do not assume "all eligible" is what the user
wants — each worker costs tokens and produces a PR someone must review. Name
the real constraint: *"4 branches are eligible. Each becomes a PR. How many do
you want running?"* Use `--max N` to honour the answer.

### 3. Fan Out

```bash
../plot/scripts/plot-dispatch.sh [--max N] <slug>
```

Per branch the script: creates `../plot-wt-<suffix>`, **claims the branch by
pushing its ref**, and starts a detached worker. A push that would overwrite an
existing branch is rejected — that rejection is the concurrency control, and
the skipped branch is reported, not retried.

`--no-start` prepares worktrees and claims without starting anything, for when
you want to drive the sessions yourself.

### 4. Report

Read the footer, never re-count:

```
summary: dispatched=3 reused=0 skipped=1 started=3
```

Say what is now running, where the worktrees are, and how to watch:
`/plot-fleet <slug>` for state, `../plot-wt-*/.plot-worker.log` for output.

## Configuration

Starting workers requires the adopting project to say how (Principle 5 — Plot
hardcodes no tooling):

```markdown
## Plot Config

- **Worker command:** claude -p "Implement the branch named in $PLOT_BRANCH per the plan. Follow the DoD. Open a PR. Do not merge."
```

The command runs inside the worktree with `PLOT_BRANCH` and `PLOT_WORKTREE`
set, detached, with output to `.plot-worker.log` and its pid in
`.plot-worker.pid`. Without the key, worktrees are prepared and the user starts
them.

**Detached is the point:** the fleet outlives this session. Close the laptop
and the workers keep going — which is also why a dead worker needs the reaper
(`/plot-reconcile`) rather than being noticed here.

## Guardrails

- **Never dispatch a blocked wave.** Eligibility lives in
  `plot-fleet-scan.sh`; do not second-guess it or hand-pick a branch from a
  later wave.
- **Never delete another session's worktree or ref.** A rejected claim means
  someone else is working there. Cleanup belongs to `/plot-reconcile`.
- **Never merge.** Workers open PRs; merge authority stays with the human.
- **Re-running is safe.** Existing worktrees are adopted, claimed branches stay
  claimed. A dispatcher that dies halfway through can simply be run again.

## Common Mistakes

| Mistake | Effect | Prevention |
|---------|--------|------------|
| Fanning out without a dry run | Five agents start on work the user wanted scoped | `--dry-run` first, always, and ask |
| Dispatching every eligible branch by default | PR review becomes the bottleneck; DoD gaps pile up | Ask for a count; offer `--max` |
| Treating a rejected claim as an error | Duplicate work, or a deleted worktree someone was using | Rejection is normal — it means the lock worked |
| Creating worktrees inside the repo | They appear in the repo's own status and globs | Worktrees are siblings: `../plot-wt-<suffix>` |
| Starting workers that merge their own PRs | Concurrent merges invalidate each other's bases | The worker command must say "open a PR, do not merge" |
