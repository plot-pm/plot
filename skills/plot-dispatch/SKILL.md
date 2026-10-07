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
  version: 0.16.0
compatibility: >-
  Designed for Claude Code and Cursor. Requires git with worktree support and
  python3. Starting workers needs a `Worker command` in Plot Config, which
  /plot-init writes as the worker loop; where it is absent the first dispatch
  offers to write it, and without it worktrees are prepared and you start them
  yourself.
---

# Plot: Dispatch

Turn one approved plan into several agents working at once — one git worktree
and one detached worker per eligible branch, each branch claimed atomically so
no two sessions collide.

This is the **writing** half of the fleet; `/plot-pulse` is the reading half.
They never talk to each other: the pulse reports what is eligible, a human
decides to dispatch it. That separation is what makes the whole thing
restartable — kill anything, and the next pulse re-derives the truth from git.

**Fanning out is human-paced** (Manifesto, Pacing). It commits scope: several
agents, several branches, real tokens. Monitoring is automatable; committing to
parallel work is a decision. This command therefore never runs itself, and
`--dry-run` exists so the decision can be taken with the facts in hand.

**Input:** `$ARGUMENTS` = `[--dry-run] [--no-start] [--max N] [--allow-local]
[--allow-waiting] <slug>`,
or `--start [N]` to bring free agents into existence,
or `--status` / `--stop <branch>` / `--restart <branch>` to inspect, stop or
replace a worker, or `--release <branch>` to return an abandoned claim to the
queue, or `--migrate [--yes]` to move idle legacy worktrees into the
configured `Worktree root:`.

## Model Guidance

| Steps | Min. Tier | Notes |
|-------|-----------|-------|
| 1. Preflight | Small | Phase check + one script call |
| 2. Dry run and confirm | Mid | How many agents is a judgment about cost and review capacity; the `in flight:` lines are facts to relay, and whether a shared file matters is the user's call. A `skipped … (held …)` line needs no judgment at all — the script decided, and it is relayed as decided |
| 3. Offer the worker loop | Mid | One config read decides whether to ask at all; proposing the loop without a harness example, and recording a no as `none` rather than leaving it blank, is the judgment |
| 4. Fan out | Small | The script does the work; claims are atomic |
| 5. Write a brief per branch | Frontier | Delegated to `/plot-implement`, whose brief step is itself Frontier: naming the alternatives the plan rejected is judgment |
| 6. Report | Small | Read the footer counts and `worker=`; relay a failed `Started:` booking verbatim |

> **User interaction:** Use `AskUserQuestion` (Claude Code) / `ask_question` (Cursor).
>
> **No user present?** If `PLOT_UNATTENDED=1` is set, do not call the question tool — each question below declares what to do instead, and every skipped question is named in the output. See [Running unattended](../plot/docs/unattended.md).

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

> **Unattended (`PLOT_UNATTENDED=1`):** stop. Fan-out spends tokens and creates
> PRs a person must review, and "all eligible" is precisely the assumption this
> step exists to prevent — an unattended run must not make that call by
> defaulting to it. Report the dry run in full, including any `in flight:`
> lines, and start nothing. A caller that genuinely wants a fixed number passes
> `--max N` explicitly, which *is* the answer and leaves nothing to ask.
> `PLOT-UNASKED: How many of <n> eligible branches to start? — stopped — dry run shown; no worktree created, no worker started`

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

**One thing here *is* refused, and it is a different question.** A file two
branches share is a prediction. A worktree that already exists *for the
candidate itself*, holding work that has not landed, is a measurement — somebody
is at that desk. Dispatch refuses that branch, counts it `skipped`, and names
the worktree path; see [The held-branch gate](#the-held-branch-gate) below.

No lines means nothing is held — the report stays silent rather than printing
reassurance nobody would keep reading.

The report is capped at 8 branches and 6 files each, with the remainder counted
(`(+4 more)`, `…and 5 more branches`). When you see an overflow line, the fleet
is busy enough that `/plot-pulse <slug>` is the better view — say so rather than
re-deriving the omitted rows yourself.

#### The held-branch gate

A branch whose **worktree already exists with work that has not landed** is
refused rather than dispatched. Unlanded means either commits that are not in
the default branch **or** uncommitted changes in the working tree — an agent
mid-edit has often committed nothing at all:

```
skipped feature/the-row-carries-its-verdict (held — worktree exists with unlanded work)
  worktree: /path/to/plot-wt-feature-the-row-carries-its-verdict
  nobody claimed it, so nothing here can tell a live agent from an
  abandoned desk. Check it, then remove the worktree or let it finish.
```

**Why this exists.** `/plot-pulse` derives every state from `origin/<branch>`,
so a branch whose work was never pushed has no claim, and no claim reads
*eligible*. On 2026-08-20 a dry run reported `claimed=0` across a fleet with
four live agents and offered two branches that were already implemented, tested
and green. Dispatch is the one component that can catch this, because it reads
this machine's worktrees for the collision report above.

**What to do with it.** Look at the worktree. It is either a live agent — leave
it alone — or an abandoned desk, in which case remove the worktree and re-run.
The gate deliberately **does not claim the branch for you**: a claim ref for a
worktree Plot did not create is a record nobody asked for, and `/plot-reconcile`
cannot tell a stale claim from a real one.

`--dry-run` refuses identically, and `--allow-local` does **not** override it —
that flag is about reading a plan's phase without a remote, and says nothing
about whether a human is mid-edit. A leftover worktree whose tip **has** merged
and which holds no uncommitted changes is still dispatched: those accumulate
normally, and refusing them would fire the gate on exactly the branches that are
safe.

The worktree is found by **asking git which one holds the branch**, not by
guessing a path from the branch name — hand-made worktrees are the population
this gate is for, and they rarely follow dispatch's `plot-wt-<flattened>`
convention.

### 3. Offer the Worker Loop — Once

**Only when `Worker command` is absent entirely**, and only here:

```bash
../plot/scripts/plot-config.sh get "Worker command" ""
```

Empty output means the repository is not set up to start agents: `/plot-init`
writes the key, and this repository has none. Propose the loop, with the count
from the dry run in hand:

```
3 branches eligible.
No `Worker command` configured — worktrees will be prepared
but no agent started.

Start agents with Plot's worker loop?
Writes: - **Worker command:** PLOT_UNATTENDED=1 plot-worker-loop.sh
```

**Never offer a harness command.** Not in the prompt, not as an
`AskUserQuestion` option, not as a "for instance". The loop is Plot's own
script; the harness call belongs in the project's `.plot/worker-prompt.sh`,
and an example harness command becomes a template, after which Plot has
effectively hardcoded a tool it is not supposed to know (Principle 5).

**Write the answer to `## Plot Config` either way**:

| Answer | Write | Meaning |
|---|---|---|
| yes | `- **Worker command:** PLOT_UNATTENDED=1 plot-worker-loop.sh` | dispatch starts the loop, which runs `.plot/worker-prompt.sh` |
| no | `- **Worker command:** none` | asked; this repo starts them by hand |

The value is the loop's bare name: `plot-dispatch.sh` puts its own directory
first on `PATH` when it launches the command, so the name resolves to the loop
shipped beside it, and a plugin path's version and an absolute path's machine
stay out of the config.

**After a yes, check the prompt file.** Where `.plot/worker-prompt.sh` is
absent, say so and name the command that writes it from the shipped template:

```bash
../plot/scripts/plot-install-prompt.sh
```

**Where `Agent runner` reads `sdk`, the prompt file is `.plot/worker-prompt.md`.** The JS loop sends its text as one agent turn through the Agent SDK, fills `{branch}`, `{brief}` and `{scripts}`, and appends the `next` hand-back protocol. Where it is absent, say so: the loop reads Plot's shipped `../plot/templates/worker-prompt.md` and logs that once, and a project copies that file to `.plot/worker-prompt.md` to change the text. The `.md` and the `.sh` hold the same project text for the two runners, a declared duplicate.

> **Unattended (`PLOT_UNATTENDED=1`):** stop, and write **nothing** to
> `## Plot Config`. Both answers above are durable configuration, so an
> unattended default would not merely act unasked — it would record a choice
> nobody made and stop the question ever being asked again. `none` in
> particular means *a person considered this and declined*, which is a claim an
> agent cannot truthfully make. Prepare no worktrees.
> `PLOT-UNASKED: Start agents with Plot's worker loop? — stopped — Worker command absent; config left untouched`

`none` is a **deliberate absence**, and recording it is what stops the question
returning. A no is first-class — hand-starting works, and the config removes a
step rather than declaring the manual path wrong. A prompt that comes back
every dispatch is a nag, and nags get answered with whatever silences them.
`plot-dispatch.sh` never runs `none` as a command; it reports `worker=declined`.

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
`/plot-pulse <slug>` for state, `../plot-wt-*/.plot-worker.log` for output.

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
hardcodes no agent tooling). `/plot-init` writes the worker loop, and step 3
offers the same value where the key is absent:

```markdown
## Plot Config

- **Worker command:** PLOT_UNATTENDED=1 plot-worker-loop.sh
```

The command runs inside the worktree with `PLOT_BRANCH`, `PLOT_WORKTREE` and
`PLOT_SESSION_ID` set, detached, with output to `.plot-worker.log`. The loop
runs the project's `.plot/worker-prompt.sh` once per slice, and that file holds
the harness call; `plot-install-prompt.sh` writes one from the shipped
template. The bare name resolves because `plot-dispatch.sh` puts its own
directory first on `PATH` for the command it launches, so a plugin install and a
checkout both run the loop shipped beside the script.

**Free agents need the loop.** `--start` refuses any configured `Worker command`
that does not run `plot-worker-loop.sh`, before it cuts a desk, and its repair
names `PLOT_UNATTENDED=1 plot-worker-loop.sh` first: a free agent starts with an
empty `PLOT_BRANCH`, only the loop waits for the registry to hand it a slice,
and any other command runs its prompt at once and exits. A worker given a branch
— a fan-out or `--restart <branch>` — works with any command, for example a
plain `claude -p "Implement the branch named in $PLOT_BRANCH …" --session-id "$PLOT_SESSION_ID"`.

**`--session-id` IS RIGHT IN A ONE-SHOT COMMAND AND WRONG IN A LOOPING PROMPT.**
A plain command runs once, and one prompt CREATES one session. The loop hops
between slices and runs the prompt file once per slice, so the flag is the
loop's decision and the prompt file interpolates `$PLOT_SESSION_FLAG`. See
*`PLOT_SESSION_ID`, and the one line an adopting project must add* below.

`--session-id` is shown because the command is the one place a person writes
the invocation, and passing the id is the only half of the contract Plot cannot
fulfil itself: dispatch mints the id and records it in the manifest, and the
runtime writes its transcript under that id only if it is told. Pass it and the
board can join an agent's row to its transcript and a correction can resume the
same conversation. Omit it and the worker runs exactly as before, its
transcript is unattributable, and resume reports itself unavailable — which is
the honest answer rather than a failure. A command that may run outside
dispatch should guard the flag; `.plot/worker-prompt.sh` in this repo shows the
portable form, since `--session-id ""` is worse than passing nothing. The **agent's** pid — the
process the command names, not the shell that wraps it — is recorded in
`.plot-worker.pid`, so the panel describes the process doing the work; the
wrapper's own pid is kept in `.plot-worker.wrapper.pid`, where it records the
run's exit code. Without the key, nothing starts: worktrees are prepared, and
the line names the value to set.

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

### `PLOT_SESSION_ID`, and the one line an adopting project must add

The dispatcher mints a session id, records it in the manifest as both `session`
and `resumeId`, and exports it into the worker's environment as
`PLOT_SESSION_ID`. Where the `Worker command` is `plot-worker-loop.sh`, that
loop runs the project's prompt once per slice and decides which FLAG the id must
carry, re-exporting the pair as `PLOT_SESSION_FLAG` and `PLOT_SESSION_ID` before
each one. **Plot stops there.** The invocation
lives in the project's own `.plot/worker-prompt.sh` — or in its `Worker command`
— and Plot owns neither that file nor the harness it runs, so it cannot add a
flag to it and must not quietly require one.

The contract is therefore split, and each side does exactly its half:

```
Plot            → PLOT_SESSION_FLAG and PLOT_SESSION_ID, before each prompt
project's file  → claude -p "…" "$PLOT_SESSION_FLAG" "$PLOT_SESSION_ID"
Plot            → checks whether a transcript for that id exists
```

**THE FLAG IS PLOT'S DECISION, AND HARDCODING `--session-id` FAILS ON A SECOND
SLICE.** `--session-id` asks the runtime to CREATE a session and succeeds
exactly once; the id is minted at launch and does not change when an agent hops.
Measured 2026-09-05: three agents finished their first slices, were handed a
second each, and every one was refused with `Session ID … is already in use` —
the prompt exiting in under a second and the loop reading it as a completed
slice. The loop now probes the transcript and emits `--session-id` on a first
prompt and `--resume` after, so a project interpolating the exported flag cannot
reproduce this whatever else it rewrites.

**A blank value must never reach `--resume`.** That flag is optional-valued —
*"Resume a conversation by session ID, or open interactive picker"* — so a blank
opens a picker inside a `-p` run with no terminal and hangs, where
`--session-id ""` at least fails loudly. Build both arguments inside one
`[ -n "${PLOT_SESSION_ID:-}" ]` guard, or omit both.

Pass it on, and two things become possible: the board joins the agent's row to
its transcript (model, context size, last activity), and a correction can be
delivered into the **same conversation** with `--resume` rather than starting an
agent that re-derives an hour of reading.

**Omit it and nothing breaks — the capability is simply reported unavailable.**
The runtime writes its transcript under an id of its own choosing, Plot's
asserted id names no file, and `resumeAvailability` says so by name. A caller
that wanted to resume starts a fresh worker instead, with the failures written
into its brief. That is the design: *a resume path that silently did nothing
would be worse than not having one, because a supervisor would report a
correction it never delivered.*

**The check is the gate, not this documentation.** Nothing asserts the flag was
added; the transcript's presence is what is measured, so a project that changes
harness or drops the flag is reported honestly rather than assumed compliant.

**A harness that is not `claude` is a supported answer.** Some write no
transcript at all, and some name it differently. Both read as *resume
unavailable*, which is the truth about that project rather than a defect in it.

## Starting free agents

A fan-out hands slices to the registry and starts nothing. The registry matches
a queued slice to a **free** agent — running, holding no branch — and until one
exists there is nobody to match. Measured 2026-09-05: a dispatch reported
`handed over feature/... → the registry` and `started=0`, the supervisor ticked
`queued=456 idle=0`, and `agents registered: 0`.

```bash
../plot/scripts/plot-dispatch.sh --start        # three free agents
../plot/scripts/plot-dispatch.sh --start 5      # five
../plot/scripts/plot-dispatch.sh --start --dry-run
```

Each agent gets a desk, a manifest naming **no branch**, and a loop that waits.
The `Worker command` must therefore run `plot-worker-loop.sh`; any other command
is refused with `worker=no-loop` in the summary and the repair on stderr, and no
desk is cut. An absent key reports `worker=unconfigured` and names the value to
set.
`isAgentFree` already reads that state as available, so the supervisor's next
tick can hand each one a queued slice with nobody touching a desk.

**The count is a request, and the machine has the last word.** It is reduced by
the workers already running — so `--start 3` twice gives three agents, not six —
and reduced again by what the machine can bear. A run that starts two of three
says which and why; run it again when the machine clears. **The shortfall is
never remembered**, because a stored target would be the fleet's first piece of
state.

**Where a free agent sits.** Its desk is cut DETACHED at `origin/<main>`. It has
no branch to cut one from, and the worker loop's own hand-over already passes
through exactly that state — `reset_desk` checks out `origin/<main>` detached
before attaching the next slice. Detached rather than *on* the default branch:
a tree sitting on the default branch is one of `plot-reap.sh`'s five refusals,
and that refusal exists to describe a tree whose dispatched branch was never
checked out, which a free desk is not.

**An idle agent dies on the existing bound.** `Worker bound` caps a worker at
eight hours and an agent handed nothing lives under the same number. There is no
idle-specific bound, because *how long is too long to wait* has no measurement
behind it yet.

## Inspecting, stopping, restarting and releasing

Detached workers would otherwise be invisible:

```bash
../plot/scripts/plot-dispatch.sh --status              # every worktree: pid, alive?, last log line
../plot/scripts/plot-dispatch.sh --stop feature/x      # stop one worker
../plot/scripts/plot-dispatch.sh --restart feature/x   # hand a stopped branch to a new worker
../plot/scripts/plot-dispatch.sh --release feature/x   # give an abandoned claim back to the queue
```

These and `--start` all work **regardless of the plan's phase** — work already running must
stay inspectable even if the plan was since delivered. `--stop`, `--restart`
and `--release` each require an explicit branch name (containing `/`); there is
deliberately no "stop everything", no "restart whatever looks stuck", and no
"release every stale claim".

**`--stop` keeps the claim; `--release` gives it up.** Stopping leaves the
worktree, the claim ref and the agent's manifest in place: the branch stays
taken, because stopping is not abandoning. `--release <branch>` is the act that
returns the slice to the queue.

### Releasing an abandoned claim

An assignment has **two records**: the claim ref `origin/<branch>`, which the
scan and the registry's queue read, and the `branch` field of the agent
manifest in the `Agent registry` directory, which the registry wrote at the
hand-over. `--release` clears both, the manifests first and the ref second. If
the ref deletion fails, the ref still locks the slice and nothing hands it out
twice.

**Do not delete the ref by hand.** That clears the first record and leaves the
second: the queue offers the slice again while a manifest still names it.
Measured 2026-09-26, `feature/the-board-filters-to-my-work` was handed out
twice after that repair. `plot-reap.sh` and `/plot-reconcile` report
*"still claimed, no commits → needs judgment"*; `--release` is how a person acts
on that judgment.

| measurement | answer |
|---|---|
| an open or merged PR exists | **refuse** — review it, or let `plot-release-refs.sh` release a merged ref |
| the host cannot be asked, or `--offline` | **refuse** — a deleted ref cannot be re-created |
| a live process (`running`) | **refuse** — names the pid; `--stop` it first if you mean to |
| a commit on `origin/<branch>` that changes files | **refuse** — that is work, not a claim |
| the desk holds unpushed commits or uncommitted changes | **refuse** — names the desk and the files |
| a `PLOT-BLOCKED*` marker on the desk | **refuse** — the agent waits on a person |
| none of the above | **release** — clear every manifest naming the branch, then delete the ref, then detach a desk still holding the branch |

A claim is an empty commit, so a claim-only ref changes no file and releases.
No manifest naming the branch is not a failure: the ref is released and the
output says so. A ref already deleted by hand with a manifest still naming the
branch is released too — the manifest is the half that was missed. A refusal
writes nothing.

**A released desk gives the branch up.** After the ref is deleted, a desk still
on the branch holds at most empty claim commits. `--release` detaches it at
`origin/<main>` and deletes the local branch, so the next agent handed the slice
can check it out. Measured 2026-10-02: with the ref gone, the old desk had no
upstream, `checkoutYield` read its claim commit as `unpushed-commits` and kept
it, and 15 agents in a row wrote `PLOT-BLOCKED` for two released slices. The
desk is detached only when its HEAD is the branch, no worker is alive in it, no
commit beyond `origin/<main>` changes a file, and `desk_dirt` reads its tree
clean; otherwise it is left as it is and the output names the reason. The
worktree itself stays — removing it is `plot-reap.sh`'s act.

### Why restart is a separate verb

A plain `plot-dispatch.sh <slug>` will never restart anything, and that is
deliberate. The dispatcher asks the scan for `--next`, which offers only `open`
branches — meaning no ref exists at all. A branch that has ever been claimed is
`claimed` or `wip`, so it is never offered; that `open`-only rule is Plot's
**lock**, the thing that stops two workers claiming one branch. Widening it
would hand claimed branches to all three of `--next`'s callers, and the board's
auto-dispatch would begin restarting stalled work on a five-second timer with
nobody deciding anything.

So restart is a second question rather than a wider first one, and a person
asks it: deciding that a stopped worker should be **replaced** rather than its
work reviewed, reaped, or abandoned is exactly the call Plot leaves to a human.

**It refuses on measurements, and the PR is asked first — before the state
word.** Five of five `failed` worktrees measured in this estate held a PR, four
open and one already merged, because `plot-worker-state.sh` refines `finished`
by the tree but deliberately does not refine `failed`. A gate reading the state
word alone would restart all five and discard exactly what the `finished`
refusal protects.

| measurement | answer |
|---|---|
| an open or merged PR exists | **refuse** — the work reached review, whatever the exit code said |
| a live process (`running`) | **refuse** — names the pid; stop it first if you mean to replace it |
| a `PLOT-BLOCKED*` marker (`waiting`) | **refuse** — names the file; a new worker meets the same question |
| none of the above | **restart** — `stalled`, `failed`, `ended`, `none` alike |

There is no `--force`. A flag overriding a liveness refusal is the flag typed
reflexively, and what it would override is another agent's work.

The worktree is inherited **exactly as it stands**. A `stalled` tree holds
uncommitted work — that is what `stalled` means, and a measured stall here left
324 finished lines on the floor — so nothing is cleaned, reset or stashed. The
new worker starts through the ordinary dispatch path, so it gets a manifest and
the fleet can see it: a restart the fleet cannot see has not succeeded.

## Migrating existing worktrees into the configured root

A repo can adopt a `Worktree root:` after it already has worktrees living in
the legacy default (beside the repo, `plot-wt-*`). New dispatches go to the
configured root immediately; the worktrees already on disk stay where they are
and keep working. **A mixed estate is an ordinary state, not a transition to
complete — `--migrate` is never required.**

```bash
../plot/scripts/plot-dispatch.sh --migrate         # dry-run: what WOULD move, and what is skipped
../plot/scripts/plot-dispatch.sh --migrate --yes   # actually move the idle ones
```

**The refusals are the feature.** `git worktree move` on a checkout an agent is
writing to breaks it mid-run, so `--migrate` moves a worktree only when it has
**no live worker and no unlanded work**, and names every one it skipped with the
reason — modelled on `plot-reap.sh`, which refuses on measurements rather than
judgements. It skips a worktree with a live worker (asked through the same
`plot-worker-state.sh` the fleet uses), a `PLOT-BLOCKED*` marker, uncommitted
changes, or unpushed commits. A refused worktree is not an error.

`--dry-run` is the default, like `plot-reap.sh`; `--yes` moves. A repo declaring
no `Worktree root:` has nothing to migrate, and the mode says so rather than
inventing a destination. It touches no branch and no ref — a move is
re-creatable with `git worktree move` back — and it works regardless of plan
phase, since it operates on the estate rather than one plan.

## Guardrails

- **The phase and `Impl:` checks are gates in the script**, not advice here.
  `plot-dispatch.sh` refuses a plan that is not Approved, or whose `Impl:`
  answer is not `own branches`, and it **fails closed** if the phase cannot be
  read. You cannot talk it into fanning out unapproved work.
- **The phase is read from `origin/<main>`, never the working tree.** The
  question the gate means to ask is *has this plan been approved where everyone
  can see it?*, and only the shared ref answers it. So an approval committed
  locally and never pushed does **not** open the gate — push it first — and a
  checkout parked on another branch does **not** hide an approval that is
  already shared. Every refusal names the ref and sha it read.
- **`--allow-local` is the escape for a repo with no remote**, and nothing else.
  It gates on the working tree and says so on stderr. Reach for it only when
  `origin/<main>` genuinely cannot be resolved; using it to get past a refusal
  is how unapproved work gets dispatched. It does **not** unlock a held branch —
  see the next point, which it has no bearing on.
- **A branch whose `waits:` prerequisite has not merged is refused by name**, and
  the refusal says what it waits on. A plan may annotate one branch
  `<!-- waits: <branch> -->`, naming one branch — usually of another plan — that
  must merge first. The question goes to the host's pull requests, never to the
  refs: `plot-release-refs.sh` deletes a delivered plan's merged refs, so a
  prerequisite that succeeded and was then reaped has no ref, and a refs-reading
  gate would block its dependent forever. Two refusals, and they send you to
  different places: `waiting` means the prerequisite exists and has not landed —
  dispatch it when that merges; `blocked` means the host has never seen a pull
  request for that name — a typo, so fix the plan. A host that could not be asked
  holds the branch at `waiting`, because silence is neither permission nor proof
  of a typo.
- **`--allow-waiting` starts a waiting branch anyway**, and prints the override on
  the line it overrides. Reach for it when you know the prerequisite is not
  really needed for the slice in hand; it does not unlock a held desk or a
  blocked wave, and it says on the record what it let through.
- **A held branch is refused by the script**, not by your judgement. A worktree
  on this machine carrying unlanded work means somebody is at that desk, and the
  fleet scan cannot see it — the work is often unpushed, so there is no claim and
  the branch reads *eligible*. Dispatch counts it `skipped` and names the path.
  Do not route around it by deleting the worktree without looking, and do not
  claim the branch by hand to make it dispatchable.
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
| Trusting `claimed=0` as "nobody is working" | A second agent onto finished work — measured, four live agents, two green branches offered | `claimed` counts pushed refs; the held-branch gate reads this machine's worktrees |
| Creating a worktree by hand, then dispatching | No claim ref exists, so the fleet reads the branch as free | Dispatch through the script; the gate now refuses what the shortcut left behind |
| Creating worktrees inside the repo | They appear in the repo's own status and globs | Worktrees are siblings: `../plot-wt-<suffix>` |
| Starting workers that merge their own PRs | Concurrent merges invalidate each other's bases | The worker command must say "open a PR, do not merge" |
| Stopping at the fan-out | A prepared, claimed worktree that nobody was handed — the gap a human closed by hand every time | Step 5: `/plot-implement` per dispatched branch |
| Fanning out with `worker=unconfigured` and not saying so | Claimed branches nobody is working on, and a last line that reads like success | Step 3 asks once; step 6 relays `worker=` |
| Suggesting a harness command | The example becomes a template, and Plot has hardcoded agent tooling (Principle 5) | Offer the worker loop; offer no harness command, not even "for instance" |
| Asking again after a no | A nag, answered with whatever silences it — including a wrong command | Record `none`; it means asked-and-declined |
| Writing the brief here instead of calling `/plot-implement` | A second definition of what an implementer needs, drifting from the first | One definition; dispatch invokes, never re-implements |
