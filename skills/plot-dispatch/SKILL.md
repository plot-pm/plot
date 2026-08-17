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
  python3. Starting workers needs a `Worker command` in Plot Config; the first
  dispatch asks for one, and without it worktrees are prepared and you start
  them yourself.
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
| 3. Ask about the worker command | Mid | One config read decides whether to ask at all; asking without an example, and recording an empty answer as `none` rather than leaving it blank, is the judgment |
| 4. Fan out | Small | The script does the work; claims are atomic |
| 5. Write a brief per branch | Frontier | Delegated to `/plot-implement`, whose brief step is itself Frontier: naming the alternatives the plan rejected is judgment |
| 6. Report | Small | Read the footer counts and `worker=`; relay a failed `Started:` booking verbatim |

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

### 3. Ask How This Project Runs an Agent Headless — Once

**Only when `Worker command` is absent entirely**, and only here:

```bash
../plot/scripts/plot-config.sh get "Worker command" ""
```

Empty output means nobody has been asked. Ask now, with the count from the dry
run in hand:

```
3 branches eligible.
No `Worker command` configured — worktrees will be prepared
but no agent started.

How does this project run an agent headless?
(leave empty to keep starting them yourself)
```

**Never offer an example command.** Not in the prompt, not as an
`AskUserQuestion` option, not as a "for instance". An example becomes a
template, and then Plot has effectively hardcoded a tool it is not supposed to
know (Principle 5). The problem was never *which* command — it is that nobody
learns the option exists.

**Write the answer to `## Plot Config` either way**, and that is the whole point
of asking here:

| Answer | Write | Meaning |
|---|---|---|
| a command | `- **Worker command:** <what they said>` | dispatch starts workers |
| empty | `- **Worker command:** none` | asked; this repo starts them by hand |

`none` is a **deliberate absence**, and recording it is what stops the question
returning. An empty answer is first-class — hand-starting works, and the config
removes a step rather than declaring the manual path wrong. A prompt that comes
back every dispatch is a nag, and nags get answered with whatever silences them.
`plot-dispatch.sh` never runs `none` as a command; it reports `worker=declined`.

**Never ask this at `/plot-init`.** Adoption runs long before anyone fans out
work — often before the repo has a second branch — so the question arrives about
a need the answerer does not have. It gets a shrug, the key is written empty,
and nobody revisits it: **an answered-and-wrong config is harder to fix than a
missing one**, because nothing later notices it was never really decided. Here
the consequence is concrete and immediate: *these branches are about to be
prepared and nobody will start them.*

Skip this step when the key already holds anything at all — a command or
`none`. Both mean the question has been answered.

### 4. Fan Out

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

### 5. Write a Brief per Dispatched Branch

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

### 6. Report

Read the footer, never re-count:

```
summary: dispatched=3 reused=0 skipped=1 started=3 brief=missing worker=configured
```

Say what is now running, where the worktrees are, and how to watch:
`/plot-fleet <slug>` for state, `../plot-wt-*/.plot-worker.log` for output.

`brief=missing` is the script reporting that **it** wrote none, which is always
true — it never can. If step 5 ran, say so; the summary is describing the
script's own reach, not the outcome of the dispatch.

`worker=` says why `started=` is what it is, and the prose line above the footer
says the same thing for a human:

| `worker=` | Means | What to relay |
|---|---|---|
| `configured` | a `Worker command` exists | what is running, and where the logs are |
| `unconfigured` | nobody has been asked | step 3 was skipped — go back and ask |
| `declined` | asked; this repo starts workers by hand | the worktrees are ready; name them so the user can `cd` in |
| `suppressed` | `--no-start` | exactly what was requested — not a defect |

`unconfigured` on a real fan-out means step 3 did not happen. That is the state
this whole command spent an evening in: worktrees claimed, nobody working on
them, and nothing in the last line saying so.

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

`- **Worker command:** none` records that the question was asked and the answer
was *we start them by hand*. It is never run as a command, and it stops step 3
asking again.

**The example above is documentation, not a suggestion.** Do not repeat it —
or any other command — into the step 3 prompt. Someone reading this file has
come looking for the format; someone being asked the question has not, and an
example put in front of them becomes the answer.

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
| Stopping at the fan-out | A prepared, claimed worktree that nobody was handed — the gap a human closed by hand every time | Step 5: `/plot-implement` per dispatched branch |
| Fanning out with `worker=unconfigured` and not saying so | Claimed branches nobody is working on, and a last line that reads like success | Step 3 asks once; step 6 relays `worker=` |
| Suggesting an example `Worker command` | The example becomes a template, and Plot has hardcoded agent tooling (Principle 5) | Ask the question; offer no command, not even "for instance" |
| Asking again after an empty answer | A nag, answered with whatever silences it — including a wrong command | Record `none`; it means asked-and-declined |
| Asking at `/plot-init` | A shrug at adoption writes an empty key nobody revisits | Ask at the first dispatch, where the consequence is concrete |
| Writing the brief here instead of calling `/plot-implement` | A second definition of what an implementer needs, drifting from the first | One definition; dispatch invokes, never re-implements |
