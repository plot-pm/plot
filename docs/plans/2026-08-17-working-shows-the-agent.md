# WORKING shows the agent, not just the branch

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

## Notes

`plot-dispatch.sh:168-170` already prints the log path and its last line.
The information has been one read away since the dispatcher shipped.
