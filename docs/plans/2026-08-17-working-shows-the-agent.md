# The board watches the machine it runs on

## Status

- **Phase:** Draft
- **Type:** feature
- **Review:** pr
- **Impl:** own branches
- **Approved:**
- **Started:**
- **Delivered:**
- **Released:**

## Approval

- **Assignee:** jwloka

## Problem

An agent stopped to ask a question, and the board sent it to WAITING ON
YOU with the note *worker finished — review it*. The row said:

```
Design  working-rows-show-their-…  feature/the-line-flashes-on-any-written-update
        worker finished — review it                                        7m
        unpushed work   2 commits only this machine can see
```

Three statements that cannot all be acted on. There was nothing to
review: no PR, no pushed branch, two local commits — and a log ending in
a direct question to the reader, with three options weighed and a request
to choose.

### The section boundary the incident exposed

**WAITING ON YOU is for results.** Branches, PRs, CI status, failures —
things a person inspects and decides about. Everything in it can be acted
on by looking at the git host.

**WORKING is for agents.** An agent that has stopped to ask something is
still an agent mid-run: its worktree is live, its context is intact, and
the thing that unblocks it is an answer rather than a review. Moving it to
WAITING ON YOU files it under the wrong verb, and it arrives there
carrying none of what that section is built to show.

### The measurement

`worker: finished` means one thing only: **the process exited 0.** Two
situations produce it and want opposite responses:

| Exit 0 because | The reader should |
|---|---|
| the work is done | review the PR |
| the agent asked and stopped | answer it |

The board cannot tell them apart, and the difference is in the log — which
the board never reads. This is the same absence-means-two-things defect
this repo has removed nine times; here it decides which SECTION a row
lands in.

### The same gap, one section along

The section boundary above holds for a second pair, and the two are one
rule rather than two defects.

**WAITING ON A MACHINE says *nothing — CI will finish*.** It describes a
STATE — nobody is blocked, a machine is working — and it is filled from
exactly one source: `pr.checks === 'pending'` on the git host. So a local
`vitest` run, a local build, a local scan is a machine working that the
board cannot show, while it sits in the very repository that run is
happening in.

| Machine is working | Board shows it |
|---|---|
| CI on the host | yes — once `mergeable` has been computed |
| a test run in this checkout | **no** |
| a build in a worktree | **no** |

Both sections are named correctly and filled too narrowly, and the shared
cause is one sentence: **the board reports what happens on the HOST, not
what happens on the machine it is running on.** `worker: running` was
sealed inside the `claimed` arm for the same shape of reason — a correct
rule with too small a scope.

This plan therefore covers both. The unit is not *the agent* and not *CI*;
it is **an observable process on this machine**, reported in whichever
section describes its state.

#### A branch is not a row

The unit above has a consequence the two sections do not yet state, and
one row per branch cannot express it. Measured 2026-08-18 while merging
`bug/one-worker-state-not-two`:

```
guard: working=0                  <- the agent had exited, cleanly
PR #218 OPEN, validate pending    <- a machine was working
```

Exit 0, branch pushed, PR open, CI still running. The row belonged to
**neither** section: not WORKING, because no agent held it; not WAITING ON
YOU, because the checks had not landed. And earlier the same afternoon the
inverse: an agent watching its own CI, which a one-row rule must file in
one section while both were true.

Both disappear once the row stops being the branch:

| Section | Lists | An entry is |
|---|---|---|
| WORKING | **agents** | *this agent is on `bug/x`* |
| WAITING ON A MACHINE | **processes** | *CI is running for `bug/x`* |

The same branch appearing in both is not duplication — the entities
differ. *Who is working?* is answered by an agent; *what am I waiting on?*
by a process. A branch is what rows mention, never what they are.

So an agent watching its own CI moves nowhere: it stays in WORKING because
it is an agent, and its CI appears in WAITING ON A MACHINE because it is a
running process. No section changes hands, and no field carries two
meanings. Each row names its branch, so two rows never read as one repeated.

#### An agent that holds nothing is still an agent

A WORKING row therefore ends when the **agent** ends — not when its work
does. An agent may have paused, may be waiting on an answer, or may be
free and ready for the next branch. Idleness is a property of an agent,
never a condition of its existence.

That last state is the one Plot cannot currently express, and the reason is
structural rather than missing detail: **Plot's agents are anchored to
branches.** A worker is started *for* a branch, holds *its* claim, and
everything recorded about it is written into that worktree —
`.plot-worker.pid`, `.plot-worker.log`, `.plot-worker.exit`
(`plot-dispatch.sh:717-722`). No worktree, no agent.

A free agent has no worktree in which its pid could live, so it is not
merely undisplayed — it does not exist as an entity. Showing capacity
requires an identity that outlives the work, which nothing writes today.

**So the dispatcher records one.** At launch it already knows the identity,
the command, the branch and the time; it writes them into the worktree
where only that branch can see them. A small manifest under `.plot/agents/`
— identity, command, started-at, session id, and the branch when it holds
one — makes the agent a thing the board can list, including with the branch
field empty. Everything in it is a fact the dispatcher has in hand.

#### The runtime already keeps half of it

Measured 2026-08-18. Claude Code writes a transcript per session at
`~/.claude/projects/<cwd-with-slashes-as-dashes>/<sessionId>.jsonl`, and
every assistant line in it carries what this plan wrote off as unrecorded:

| Field | Value observed |
|---|---|
| `model` | `claude-opus-5` |
| `usage.cache_read_input_tokens` | `156838` — context in use |
| `timestamp` | per line, so last activity is a read |
| `cwd`, `gitBranch`, `version`, `sessionId` | per line |

The path is derivable, and the session id is already on the worker's own
command line: `plot-dispatch.sh` launches through the configured `Worker
command`, and the runtime is invoked with `--session-id`.

That splits the registry rather than replacing it:

- **the manifest records the LINK** — which agent belongs to which branch,
  started when, under which session id. Nothing else knows this, because
  the runtime does not know Plot exists.
- **the transcript reports the STATE** — model, context, last activity.
  Live and self-updating, which a launch-time manifest could never be:
  context use changes with every reply.

It also reaches the state that motivated all of this. A session whose
`gitBranch` is the default and which holds no claim is an agent holding no
work — *waiting*, read rather than invented.

**Two limits, and the plan must respect both.** The format is private and
undocumented, and each line names the version that wrote it (`2.1.233`
when measured), so the board reads it defensively and omits fields it does
not recognise instead of guessing. And it is per-machine, exactly like
`.plot-worker.pid`: an agent on another host stays invisible, which this
wave does not solve and must not appear to.

This is the plan's largest wave and it is deliberately separable: the
sections split, the log, and `asking` are all reads of data that already
exists. The manifest is the one place a new fact is written — and it is
smaller than it first looked, because the runtime keeps the rest. Until it
lands, `waiting` stays honestly absent rather than faked from a worktree
that isn't there.

### What is already observable

| Fact | Where |
|---|---|
| pid | `worker_pid`, in the contract |
| exit code | `.plot-worker.exit` |
| **the log** | `<worktree>/.plot-worker.log` — deterministic path, never read |
| **model, context, last activity** | the session transcript — measured, see below |
| which agent holds which branch | **nowhere** |
| capabilities | **nowhere** |

The log is 3 KB of the agent's own account of its run, sitting on disk
next to data the board already reads. The dispatcher even prints its path
and its last line (`plot-dispatch.sh:168-170`) — into a log nobody reads
either.

> This table read *model, context, capabilities — nowhere* until
> 2026-08-18, when it was checked instead of assumed. Three of the four
> are written per assistant line in the session transcript; only
> capabilities, and the Plot-side link between agent and branch, are
> genuinely unrecorded. The corrected reading is in *The runtime already
> keeps half of it* above, and it makes the manifest wave smaller rather
> than larger.

### What is NOT observable, and must not be pretended

`claude -p` is a one-way process: **no stdin after launch.** So:

- **Answering an agent is starting a new one**, with the transcript and
  the answer as its prompt. That is *continuation*, not *dialogue*, and
  the UI must not blur them.
- **Capabilities cannot be shown**, because nothing records them — unlike
  model and context, which are one file read away.
- **What Plot knows about its own agents is Plot's to record.** The
  runtime keeps no notion of a branch claim or a plan, so the link between
  an agent and the work it holds exists only if the dispatcher writes it.

## Design

Four waves. The first three are reads of data that already exists; the
fourth is the one write, and it is deliberately last.

### 1. The log travels

The worker's log path is derived, not carried: `<worktree>/.plot-worker.log`,
and the board already knows the worktree. A row in WORKING can therefore
offer its log without a single new field crossing the wire.

Served on demand rather than pushed with every pulse — a 4 s pulse
carrying every agent's console output is a different product. The row
links; the panel fetches.

### 2. A stopped-to-ask agent stays in WORKING

A fifth worker state beside `running`, `finished`, `failed`, `ended`:
**`asking`** — exited cleanly with an unanswered question.

Detected from the log's own shape, and the detection must be honest about
its confidence. The board reports *the agent's last output ends in a
question* — a fact — never *the agent needs you*, which is an
interpretation. Principle 3: the scan collects, the human concludes.

The row keeps its place in WORKING with an annotation. It does not move,
because it has not stopped being an agent.

### 3. The agent panel

What the board can honestly show about a run:

| Shown | Source |
|---|---|
| the log, live-tailed | the file |
| pid, uptime | the scan |
| the command that started it | `Worker command` config |
| branch, worktree, plan | the row |
| model, context in use, last activity | the session transcript |

The last row was measured, not assumed — see *The runtime already keeps
half of it* above. It is shown **only when the transcript is readable and
its fields are recognised**: a private format may change under the board,
and a panel that invents a model is worse than one that omits it.

Capabilities remain out of scope. Nothing records them, and unlike model
and context they are not one file read away.

### 4. Answering — a continuation, named as one

The one write. Given an answer, start a fresh worker in the same worktree
whose prompt is the previous transcript plus the answer.

Named *Continue with an answer* rather than *Reply*, because the agent
that asked is gone: what continues is the work, not the conversation. A
UI that implies otherwise would promise a channel that does not exist.

## Branches

### Log

- `feature/the-worker-log-is-readable` — the board serves a worker's log
  on demand from its deterministic path; a WORKING row offers it

### Asking

- `feature/an-agent-that-asks-stays-working` — `asking` as a fifth worker
  state, detected from the log's shape and reported as evidence; the row
  keeps its section and gains an annotation

### Panel

- `feature/the-agent-panel` — pid, uptime, command, branch and the live
  log in one view, opened from the row

### Answer

- `feature/continue-with-an-answer` — a continuation run in the same
  worktree, prompted with the transcript and the answer

### Machine

- `feature/a-local-run-is-a-machine-working` — a process this board can
  see running in its own checkout puts its row in WAITING ON A MACHINE,
  with the same evidence-not-verdict rule: *a test run is in progress
  here*, never *it will be done in three minutes*. The section is keyed on
  the process, not on the holder: a branch whose agent has exited while
  its checks still run is listed here rather than nowhere, and an agent
  watching its own CI is listed in both sections at once — once as an
  agent, once as a process — because the two sections list different
  things

### Registry

- `feature/an-agent-outlives-its-branch` — the dispatcher writes a
  manifest under `.plot/agents/` at launch (identity, command, started-at,
  session id, and the branch while it holds one), and the board reads
  model, context and last activity from the session transcript that
  manifest points at. Together they make an agent something the board can
  list with no branch at all, which is what `waiting` requires. Defensive
  by construction: an unreadable or unrecognised transcript omits its
  fields rather than guessing them

## Done when

- **A WORKING row can show its worker's log**, without the pulse carrying
  it. Assert the log arrives on demand and that a 4 s pulse is unchanged
  in size.
- **An agent that stopped to ask STAYS in WORKING.** Assert the measured
  case: exit 0, no PR, unpushed commits, log ending in a question. The
  pairing that matters: a rule keyed only on the exit code puts it in
  WAITING ON YOU, which is where this plan starts.
- **A finished agent still goes to WAITING ON YOU.** Assert exit 0 with a
  pushed branch and an open PR — the state `asking` must not swallow the
  ordinary completion.
- **`asking` is reported as EVIDENCE, never as a verdict.** Assert the
  annotation states what was observed (the last output is a question) and
  does not claim the agent needs anything.
- **The panel shows only what is recorded.** Assert the model and context
  fields are populated from a real transcript, and that an unreadable or
  unrecognised one leaves them absent rather than guessed — both
  directions, because the format is private and may change.
- **A capability is never claimed.** Assert no field names one: nothing
  records them, and this wave does not change that.
- **Answering starts a NEW run and says so.** Assert the control is named
  as a continuation and that the previous pid is not reused.
- **A row can be in WORKING and have unpushed work at once**, and say
  both — the marks already established are untouched.
- **A local run puts its row in WAITING ON A MACHINE.** Assert a process
  observable in this checkout, with no CI pending on the host — the case
  the section's own name already describes and cannot currently show.
- **It reports the observation, never a forecast.** Assert the row says
  what is running and does not name a remaining time: nothing measures
  when a local run ends, and a countdown nobody can honour is the shape
  this repo removes rather than adds.
- **A HOST-side pending check still lands there too.** Assert the
  existing path is unchanged — this widens the section, it does not
  replace what fills it.
- **A branch whose agent has exited while its checks still run is not
  homeless.** Assert the measured case: exit 0, branch pushed, PR open,
  checks pending, no worker alive — it is listed in WAITING ON A MACHINE.
  The pairing that matters: a rule keyed on the holder lists it nowhere,
  which is where this case was found.
- **An agent watching its own CI appears in BOTH sections.** Assert one
  live worker with a pending check yields an agent entry in WORKING and a
  process entry in WAITING ON A MACHINE, each naming the branch. A pending
  check must never evict a live agent from WORKING — the entities differ,
  and were only ever one row.
- **A WORKING entry ends with its AGENT, not with its work.** Assert a live
  worker whose branch has merged and whose checks have landed is still
  listed, and that it disappears when the process does.
- **An agent holding no branch is listed.** Assert an agent with no claim
  appears with an empty branch field rather than being omitted — the state
  the manifest exists for, and the one no worktree can express.
- **The manifest records only what the dispatcher has in hand.** Assert
  every field traces to launch-time knowledge (identity, command,
  started-at, session id, branch) and that none is inferred.
- **A missing or unreadable transcript costs fields, not entries.** Assert
  an agent whose transcript is absent or in an unrecognised format is still
  listed, with model and context absent rather than guessed.

## Notes

`plot-dispatch.sh:168-170` already prints the log path and its last line.
The information has been one read away since the dispatcher shipped.
