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
  version: 0.4.0
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

**Input:** `$ARGUMENTS` = `[--dry-run] [--no-start] [--max N] <slug>`,
or `--status` / `--stop <branch>` to inspect or stop running workers.

## Model Guidance

| Steps | Min. Tier | Notes |
|-------|-----------|-------|
| 1. Preflight | Small | Phase check + one script call |
| 2. Dry run and confirm | Mid | How many agents is a judgment about cost and review capacity; the `in flight:` lines are facts to relay, and whether a shared file matters is the user's call |
| 3. Fan out | Small | The script does the work; claims are atomic |
| 4. Write a brief per branch | Frontier | Delegated to `/plot-implement`, whose brief step is itself Frontier: naming the alternatives the plan rejected is judgment |
| 5. Report | Small | Read the footer counts; relay a failed `Started:` booking verbatim |

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

#### Read the `in flight:` lines

A candidate line may be followed by what other branches already hold:

```
would dispatch feature/agent-view-phase-ui → …
  in flight: bug/board-shows-staleness holds App.tsx, AgentList.tsx
```

Waves are a **within-plan** ordering. A correctly eligible branch can still name
a file an agent has open on a *different plan's* branch, and no plan can declare
that alone. These lines are that missing fact, read from local refs and
worktrees — including unpushed commits and uncommitted changes, which no remote
knows about.

**They report; they do not judge.** Nothing about the candidate's own files is
predicted, so the overlap is not computed and dispatch refuses nothing. Surface
the lines to the user and let them decide; a shared file is often fine, and
saying "these collide" would be claiming a certainty nothing here has. If a
candidate looks genuinely contested, the useful move is `--max N` or naming the
branch to hold back, not a refusal.

No lines means nothing is held — the report stays silent rather than printing
reassurance nobody would keep reading.

The report is capped at 8 branches and 6 files each, with the remainder counted
(`(+4 more)`, `…and 5 more branches`). When you see an overflow line, the fleet
is busy enough that `/plot-fleet <slug>` is the better view — say so rather than
re-deriving the omitted rows yourself.

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

Once the fan-out is done the script **records one `Started:` line per branch it
claimed**, in `/plot-implement`'s shape, on the **default branch** — through a
disposable `plot/start-<slug>` branch pushed with `plot-push-main.sh`. It is
written on the default branch because that is where the board reads plans from;
a record committed to whatever branch the dispatcher happened to be on would be
invisible, and the plan would keep reading as *Ready* while agents edit its
branches.

If that push fails — offline, refused, beaten to the ref — **the fan-out
stands**: worktrees exist and claims are pushed, and those are the real state.
The script says the record is missing and carries on. Record it by hand, or
re-run the dispatch once the push works; a re-run adopts the existing worktrees
and books nothing it did not newly claim.

### 4. Write a Brief per Dispatched Branch

A prepared worktree is not work handed over. What an implementer needs — which
alternatives the plan already rejected, and the measurements that killed them —
lives in a **hand-off brief**, and `/plot-implement` is the step that produces
one. Dispatching skipped that step, so every fan-out so far was completed by a
human writing the brief afterwards.

**For each branch the script reports as `dispatched`, invoke `/plot-implement`**
so it writes `.plot/briefs/<branch-suffix>.md` (step 4 there) and commits it on
the default branch. Skip branches reported as `reused` — a brief is already
there — and skip `skipped` ones entirely: another session holds them, and their
brief is not yours to write.

`/plot-implement` finds the branch already claimed and treats it as a resume, so
it re-creates nothing: no second claim push, no duplicate `Started:` record.
Dispatch has already booked both.

**The caller here is this skill, not `plot-dispatch.sh`.** No script in this repo
invokes a skill, and bash cannot reach one at all — skills exist inside an agent
session. That is the Manifesto's direction rather than an omission: *skills
interpret and adapt; scripts collect and report*. A brief is interpretation, and
a template string in the dispatcher would be a second definition of what an
implementer needs to know — it would drift from `/plot-implement`'s the way every
duplicated rule in this repo has.

A direct `plot-dispatch.sh` call therefore cannot write a brief. It says so in
its summary (`brief=missing`) rather than refusing: `--dry-run` and `--status`
are the normal way to look before leaping, and a gate that blocks looking is a
gate in the wrong place. When you see that in the summary, the branches are
prepared and claimed and nobody has been handed anything — the brief step is
still owed.

`--no-start` does not change this. It suppresses **workers**, not briefs; the
inspect-first workflow still wants the brief written for whoever picks the
worktree up.

### 5. Report

Read the footer, never re-count:

```
summary: dispatched=3 reused=0 skipped=1 started=3 brief=missing
```

Say what is now running, where the worktrees are, and how to watch:
`/plot-fleet <slug>` for state, `../plot-wt-*/.plot-worker.log` for output.

`brief=missing` is the script reporting that **it** wrote none, which is always
true — it never can. If step 4 ran, say so; the summary is describing the
script's own reach, not the outcome of the dispatch.

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

## Inspecting and stopping workers

Detached workers would otherwise be invisible:

```bash
../plot/scripts/plot-dispatch.sh --status            # every worktree: pid, alive?, last log line
../plot/scripts/plot-dispatch.sh --stop feature/x    # stop one worker
```

Both work **regardless of the plan's phase** — work already running must stay
inspectable even if the plan was since delivered. `--stop` requires an explicit
branch name (containing `/`); there is deliberately no "stop everything".

Stopping leaves the worktree and the claim in place: the branch stays taken
until you release it. Releasing is `/plot-reconcile`'s job.

## Guardrails

- **The phase and `Impl:` checks are gates in the script**, not advice here.
  `plot-dispatch.sh` refuses a plan that is not Approved, or whose `Impl:`
  answer is not `own branches`, and it **fails closed** if the phase cannot be
  read. You cannot talk it into fanning out unapproved work.
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
| Stopping at the fan-out | A prepared, claimed worktree that nobody was handed — the gap a human closed by hand every time | Step 4: `/plot-implement` per dispatched branch |
| Writing the brief here instead of calling `/plot-implement` | A second definition of what an implementer needs, drifting from the first | One definition; dispatch invokes, never re-implements |
