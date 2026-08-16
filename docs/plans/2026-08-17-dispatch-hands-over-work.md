# Dispatch prepares a desk and calls it starting work

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:**
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:**
- **Started:**
- **Delivered:**

## Problem

`plot-dispatch` creates a worktree, pushes a claim and books a `Started:`
record. Then it stops. Two steps of the hand-off are missing, and a human has
been supplying both by hand all evening:

| Step | Who does it |
|---|---|
| Worktree, claim, `Started:` | `plot-dispatch` |
| **Write the brief** | a person |
| **Start the agent** | a person |

Measured: `plot-dispatch.sh` contains **zero** occurrences of "brief", and this
repo has no `Worker command` configured — so even a run without `--no-start`
only prints *"worktree ready — no 'Worker command' configured, so start it
yourself"*.

The board's `Start work` button inherits the gap exactly. It calls
`plot-dispatch --max 1`, so it delivers a **prepared desk**, not work. On
2026-08-17 three rows sat in WORKING for minutes with a pulsing green dot while
nobody was working on any of them — the claim was real, the worker was never
started. The row was not lying about the claim; the pipeline was incomplete
behind it.

### The brief is not a summary of the plan

This is the part that decides the design, and it is measurable.
`plot-implement`'s brief template is **8 lines**. The briefs actually written
this session run **111–127 lines**, and the difference is not padding:

> *"`merge-tree` cannot answer this — `plot-dispatch` creates the candidate
> branch, so the comparison reports clean for every candidate, forever."*
>
> *"Do NOT route this through `worktree_rows()`. A local branch with no worktree
> still holds commits nobody can see."*
>
> *"Do not read that diff. Take either side, then rebuild — which side you take
> cannot matter."*

Every one of those is a **rejected alternative**: the obvious approach, and the
measurement that killed it. A plan records the decision; the brief records what
an implementer would otherwise re-derive. Without it, three agents this session
would have rebuilt mechanisms already disproved — the plan text alone does not
stop someone reaching for `merge-tree`, because the plan's *reasoning* reads as
background rather than as a warning aimed at them.

So the brief is **interpretation**, not extraction. That rules out generating it
in the dispatcher: Manifesto Principle 3 splits this cleanly — *skills interpret
and adapt; scripts collect and report*. A script filling an 8-line template
would produce something worse than the plan it summarises.

## Design

### `plot-implement` owns the brief; dispatch invokes it

`plot-implement` already defines the brief, already reads the plan's recorded
`Impl:` answer, and already runs the staleness preflight. It is the step that
gets skipped when someone dispatches directly — so dispatch calls it rather
than reimplementing a thinner version beside it.

**One definition of what an implementer needs to know.** A second one in the
dispatcher would drift from the first the way every duplicated rule in this repo
has: the eligible-note string became a shared constant this session for exactly
this reason, and the artifact merge strategy exists because two copies of a
generated file cannot be reconciled.

The brief lands where the briefs already live — `.plot/briefs/<branch>.md`,
committed to the default branch, so a resumed or replaced agent can read it
without the dispatching session.

**The template grows to match what briefs actually contain.** The 8-line version
describes a shape nobody has used; the real ones carry a *what to build*
narrative, the settled decisions with their measurements, the assertions that a
naive test would pass without, a bookkeeping duty and a scope guard naming the
branches in flight. That is the shape to write down — not as a form to fill, but
as the sections a brief is incomplete without.

### The worker starts, and says so when it cannot

`Worker command` already exists and is deliberately unset by default: Plot
hardcodes no agent tooling (Principle 5). What is missing is that **nothing
tells the operator they are one config line away** from an automatic fan-out.
The message appears only after a dispatch has already happened, buried in
per-branch output.

So: `/plot-init` offers to set it, and `plot-dispatch` reports the consequence
up front rather than per branch — *"no Worker command configured: 3 worktrees
prepared, 0 workers started"* in the summary, where a caller reading only the
last line sees it.

**`--no-start` keeps meaning what it says.** It is the right default for a human
who wants to inspect before letting an agent loose, and this session used it
deliberately every time. The defect was never that dispatch failed to start
workers when told not to; it was that nothing downstream noticed the result.

### The board's button completes the same pipeline

`Start work` keeps its name — it will be true once the pipeline is whole rather
than renamed to describe a gap. It calls the same path, so it inherits the brief
and the worker start without its own logic.

**A prepared-but-unstarted branch must be visible as such.** With no
`Worker command`, the button still cannot start an agent, and the row would
again claim work nobody is doing. The pulse already has both facts — the claim
is a commit, and `.plot-worker.pid` exists only where a worker was started — so
a row can distinguish *claimed and running* from *claimed and waiting for
someone to start it*. Without that, this plan fixes the mechanism and leaves the
misreport that made it visible.

## Branches

### Hand-off

- `feature/dispatch-writes-brief` — `plot-dispatch` invokes `/plot-implement`
  for the brief instead of leaving it to the caller; the brief template in
  `plot-implement/SKILL.md` grows to the shape briefs actually take

### Start

- `feature/dispatch-reports-no-worker` — the summary reports prepared-vs-started
  counts; `/plot-init` offers to configure `Worker command`

### Visibility

- `feature/fleet-sees-unstarted-claims` — a claimed branch with no running
  worker reads as waiting to be started, not as working

Three waves, sequential: the brief is the payload, the worker start is what
consumes it, and the row state describes the result. Each is useful alone, and
the third is what proves the first two landed.

## Done when

- **A dispatch produces a brief at `.plot/briefs/<branch>.md`**, committed to
  the default branch. Assert the file exists and names the plan, the branch and
  the scope guard — the three things a replacement agent cannot work without.
- **The brief comes from `plot-implement`, not from the dispatcher.** Assert
  there is one definition: a template string in `plot-dispatch.sh` fails this
  even if its output looks right.
- **A dispatch with no `Worker command` says so in the summary**, with counts.
  Assert the summary line, not per-branch output: a caller reading only the last
  line is the case this exists for.
- **`--no-start` still starts nothing**, and still writes the brief. The two are
  independent, and conflating them would remove the inspect-first workflow this
  session relied on.
- **A claimed branch with no running worker does not read as working.** Assert
  against the live shape from 2026-08-17: claim pushed, no `.plot-worker.pid`,
  no commits — three such rows sat in WORKING with a pulsing dot.
- **A claimed branch WITH a running worker still reads as working.** The
  regression that matters: a check that reads every claim as unstarted is
  indistinguishable from a broken fleet.
- `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`,
  `pnpm run validate` all pass.
- A changeset is present.
- macOS bash 3.2: no `declare -A`.

## Notes

Asked on 2026-08-17 — *should `Start work` not release the work, or how should
the process look?* — after three rows sat in WORKING with nobody working on
them.

The honest answer was that the button is accurately named for what it does and
wrongly named for what it promises, and that the gap it exposes is not the
board's: `plot-dispatch` has always stopped one step short, and every dispatch
this session was completed by hand without anyone noticing the pattern.

Deliberately out of scope: making the board start agents itself. The button
calls `plot-dispatch`, and that is the right shape — a board that steers a
session is a different architecture from a fleet of detached workers, and this
plan closes the existing pipeline rather than opening a second one.
