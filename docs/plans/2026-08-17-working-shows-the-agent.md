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

#### The row nobody holds

That unit has a consequence the two sections above do not yet state, and
it was measured on 2026-08-18 while merging `bug/one-worker-state-not-two`:

```
guard: working=0                  <- the agent had exited, cleanly
PR #218 OPEN, validate pending    <- a machine was working
```

Exit 0, branch pushed, PR open, CI still running. The row belonged to
**neither** section: not WORKING, because no agent held it; not WAITING ON
YOU, because there was nothing yet to review — the checks had not landed.

It is the same defect as the WAITING-ON-YOU misfiling above, arriving from
the other direction. There, an agent that was still an agent got filed
under a result. Here, a running process gets filed nowhere, because the
board asks *who holds this?* before it asks *is anything happening?*

**So the section is decided by the process, not by the holder.** An agent
is one kind of process, CI is another, a local `vitest` run is a third,
and a row with any of them running belongs in the section that describes
that process. A row with a holder AND a running check is in both
situations at once and must say both — the same way an established row
already says *working* and *unpushed work* together.

This costs nothing to detect: both facts are already collected, and the
board reads them today as one field. It is the reading that is too narrow,
not the data.

### What is already observable

| Fact | Where |
|---|---|
| pid | `worker_pid`, in the contract |
| exit code | `.plot-worker.exit` |
| **the log** | `<worktree>/.plot-worker.log` — deterministic path, never read |
| model, context, capabilities | **nowhere** |

The log is 3 KB of the agent's own account of its run, sitting on disk
next to data the board already reads. The dispatcher even prints its path
and its last line (`plot-dispatch.sh:168-170`) — into a log nobody reads
either.

### What is NOT observable, and must not be pretended

`claude -p` is a one-way process: no stdin after launch, and no
self-report of model, session age, context use or capabilities. So:

- **Answering an agent is starting a new one**, with the transcript and
  the answer as its prompt. That is *continuation*, not *dialogue*, and
  the UI must not blur them.
- **Agent metadata cannot be shown until something records it.** The
  dispatcher knows the command it ran and when; everything else would be
  invented.

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

Model, context and capabilities are **out of scope until something
records them** — a later wave may have the dispatcher write a small
manifest at launch, which is a change to the dispatcher rather than a
guess in the UI.

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
  the process, not on the holder: a row whose agent has exited while its
  checks still run lands here rather than nowhere, and a row with both an
  agent and a running check says both

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
- **The panel shows only what is recorded.** Assert no field claims a
  model, a context size or a capability while nothing records them.
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
- **A row whose agent has exited while its checks still run is not
  homeless.** Assert the measured case: exit 0, branch pushed, PR open,
  checks pending, no worker alive — it lands in WAITING ON A MACHINE. The
  pairing that matters: a rule keyed on the holder puts it in no section
  at all, which is where this case was found.
- **A row can hold an agent AND a running check at once**, and say both.
  Assert that gaining a pending check does not evict a live worker from
  WORKING — the two facts are independent and were only ever one field.

## Notes

`plot-dispatch.sh:168-170` already prints the log path and its last line.
The information has been one read away since the dispatcher shipped.
