# A worker asks for the next wave

> A worker exits when its wave lands, and the next wave pays to start a session
> from nothing. A worker that is still alive should be able to ask for more
> work — and the parallel-agents cap should mean something when it cannot.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** <!-- not a member of the-board-tells-the-truth-in-every-section -->
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A worker takes the next eligible wave itself when its own lands, instead of
  exiting and leaving the fleet to start a session from nothing.
- Auto-dispatch **refuses** to start a worker at the parallel-agents cap and
  says which workers hold the slots. A manual `/plot-dispatch` warns and
  proceeds: an operator exceeding the cap has decided to.

## Motivation

### A worker is one-shot, and nothing reuses it

The `Worker command` is `claude -p "<brief>"`: it runs one prompt against one
branch and exits. There is no idle-but-alive worker in this design — a worker is
either mid-task or gone.

`plot-dispatch.sh` reports `reused=N`, and that counts reused **worktrees**, not
sessions: a fresh `claude -p` is spawned into an existing directory. The desk is
reused; the person is not.

The registry's `session` field looks like the missing link and is not.
`plot_session_id()` (plot-dispatch.sh:739) returns `uuidgen` output — an
identifier Plot invents for its own bookkeeping. Claude never receives it, so
`claude -r "$session"` cannot resume anything.

### What is paid for each time

Every wave of a plan starts a session that must re-read the repo, the plan and
the brief before it can act. Measured on this repo 2026-08-24: five waves of
`the-agents-tab-filters-to-the-sprint` were dispatched as five separate
sessions, each re-establishing the same context about the same plan.

The waves of one plan are related by construction — that is what a wave IS, work
sequenced behind work. A worker that has just implemented wave five is the
cheapest possible implementer of wave six.

### The cap is a label, not a limit

`parallelAgents` bounds `maybeAutoDispatch`. Nothing else consults it:
`plot-dispatch.sh` has no such check, so a manual dispatch starts as many
workers as it has branches. On 2026-08-24 six workers ran under a cap of three.

A number a reader takes for a limit, which does not limit, is worse than no
number.

## Design

### The worker loops, and the loop is in the worker command

The `Worker command` becomes a loop rather than a single prompt:

1. Implement the branch named by `PLOT_BRANCH`, exactly as today.
2. When it lands, ask `plot-fleet-scan.sh --next` for another claimable branch.
3. If one comes back, claim it, move to its worktree, and implement it.
4. If nothing comes back — exit 1 from `--next` — exit cleanly.

`--next` already exists and already answers exactly this question: it prints one
claimable branch and exits 1 when there is nothing to start. The claim stays the
ref push, unchanged; two workers racing the same branch resolve as they do now,
one push winning.

**This is a change to configuration, not to Plot.** The loop lives in the
adopting project's `Worker command`, which is where the worker contract has
always lived. Plot's scripts gain the accounting the loop needs, and no
scheduler.

### A looping worker keeps its registry entry

Today a worker's manifest names one branch, written at dispatch. A worker that
moves to a second branch must say so, or the registry describes where it started
rather than where it is.

The manifest gains a `branch` update on each hop and a count of waves taken. The
`previousPid`/`relaunches` machinery already models a worker changing identity in
place; this is the same shape for a worker changing subject in place.

The worker row then names the wave it is CURRENTLY working — which is what
`a-busy-worker-names-its-wave` renders, and why that wave is a dependency of
this one rather than a duplicate of it.

### The worktree question

A worker that hops branches needs a worktree per branch: a worktree holds one
branch, and Plot's whole isolation model depends on that.

The worker asks `plot-dispatch.sh` for the next branch's worktree rather than
creating one itself — the dispatcher already knows how to adopt an existing
worktree or cut a new one, and duplicating that logic in a prompt would be a
second implementation of the trickiest part of dispatch.

The worker's OWN worktree is left behind, holding its finished branch. That is
correct: the branch may still need a rebase, and the registry now reports a
worktree whose session has moved on — which the reconcile rule in
`the-working-section-shows-every-worker` already covers, since a clean worktree
with an ended session is exactly what may be dropped.

### The cap gates auto-dispatch and warns a person

`maybeAutoDispatch` **refuses** at the cap and says what holds the slots — the
branches, not just a number. Refusing silently is what made the cap invisible.

`plot-dispatch.sh` **warns, RAISES THE CAP, and proceeds**. An operator running
`/plot-dispatch` has asked for something specific; refusing them to defend a
setting they can change is the wrong direction.

But proceeding past a cap must not leave the cap behind. A stored `3` beside six
running workers is a number the board itself knows to be false, and every later
reader — the control, `liveAgentCount`, the next auto-dispatch decision — reasons
from it. So exceeding the cap **updates** it: the new value is the count that
actually resulted, written back to the same setting the stepper reads.

The warning says both halves: that the cap was exceeded, and that it now reads
the higher number. A person who wanted the old bound lowers it in the stepper,
which is one click and visible.

This also keeps auto-dispatch honest afterwards. Its refusal is measured against
whatever the cap now says, so an operator who deliberately ran six workers does
not find auto-dispatch refusing at three the moment they look away.

A looping worker taking its next wave is **not** a new session and is not gated:
the slot it occupies is the one it already had. This is the whole reason the cap
can be enforced without stalling the fleet — at the cap, work continues through
the workers already running.

## Waves

### Counted (Branch: feature/the-cap-gates-auto-dispatch)
- `maybeAutoDispatch` refuses at the cap and names the branches holding the
  slots; `plot-dispatch.sh` warns and proceeds

### Asked (Branch: feature/a-worker-asks-for-the-next-wave)
- the `Worker command` loops: implement, ask `--next`, claim, move, implement;
  exit cleanly when `--next` has nothing

### Followed (Branch: feature/the-registry-follows-a-hopping-worker)
- the manifest records the branch a worker moved to and how many waves it has
  taken, so the registry names where a worker IS

## Done when

1. **A worker whose wave lands takes the next eligible wave of the same plan
   without a new session being started.** Demonstrated end to end in a sandbox
   repo with a two-wave plan: one dispatch, two waves implemented, one session.
2. **A worker exits cleanly when `--next` has nothing.** Exit 1 from `--next` is
   a normal end, not an error in the log.
3. **Two looping workers racing the same next branch: exactly one wins**, and
   the loser asks again rather than failing. The ref push already decides this;
   the assertion is that the loop handles the rejection.
4. **`maybeAutoDispatch` starts nothing at the cap** and its message names the
   branches occupying the slots.
5. **`plot-dispatch.sh` at the cap warns, names the count, proceeds, and
   RAISES the stored cap to the resulting worker count.** Asserted on the
   setting, not only on the log line: after dispatching six under a cap of
   three, the stepper reads six.
5b. **Auto-dispatch then measures against the raised cap**, so a deliberate
   override is not silently undone by the next automatic decision.
6. **A worker that hopped branches is reported on the branch it is working**,
   not the one it started on.
7. **A looping worker taking its next wave does not consume a second slot.**
   Asserted directly: the count does not rise when a worker hops.
8. `pnpm test`, `pnpm run test:e2e`, `pnpm run test:board` green.

## Notes

### Not chosen: resume the session with `claude -r`

`claude -r <id>` would reuse the CONVERSATION rather than a live process, and it
is the smaller change. It was not chosen because the identifier is not there to
use: `plot_session_id()` generates a UUID for Plot's bookkeeping and Claude never
sees it, so capturing Claude's real session id is itself a prerequisite. The
loop reuses a worker that is genuinely still running, which is what the fleet's
cap is actually about.

Worth revisiting if the loop proves hard to make reliable: resuming is stateless
between waves and therefore easier to reason about after a crash.

### Not chosen: a scheduler that assigns work to idle workers

A central scheduler holding a queue and pushing work to waiting agents is the
conventional shape and the wrong one here. Plot has no daemon, and its claim
mechanism is a ref push precisely so that no component has to be authoritative
about who is doing what. A worker ASKING is the same direction as `--next`
already works; a scheduler TELLING would need state nothing else keeps.

### Why the cap is not enforced against a hopping worker

Enforcing it there would stall the fleet at exactly the moment the mechanism
exists to prevent that: at the cap, with reuse gated, no work would start until
a worker died. The slot is already spent — a worker that continues is not a new
session, which is the thing the operator asked to bound.
