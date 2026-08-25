# A worker asks for the next wave

> A worker exits when its wave lands, and the next wave pays to start a session
> from nothing. A worker that is still alive should be able to ask for more
> work — and the parallel-agents cap should mean something when it cannot.

## Status

- **Phase:** Approved
- **Type:** feature
- **Sprint:** the-board-tells-the-truth-in-every-section
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-24, Jan Wloka, in-session
- **Started:** 2026-08-24, Jan Wloka, `feature/the-cap-gates-auto-dispatch`
- **Started:** 2026-08-25, Jan Wloka, `feature/a-worker-asks-for-the-next-wave`

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
2. When it lands, ask `plot-fleet-scan.sh --next "$PLOT_SLUG"` for another
   claimable branch **of the same plan**.
3. If one comes back, claim it and implement it **in a worktree the dispatcher
   provides** (see *The worker does not move* below).
4. If nothing comes back — exit 1 from `--next` — exit cleanly.

`--next` already exists and already answers exactly this question: it prints one
claimable branch and exits 1 when there is nothing to start. The claim stays the
ref push, unchanged; two workers racing the same branch resolve as they do now,
one push winning.

**Scoped to the plan, deliberately.** `--next` with no slug returns the first
claimable branch across the WHOLE estate (`plot-fleet-scan.sh:2328`), and a
worker that hops to an unrelated plan reuses the session while discarding the
context that justified reusing it. The whole argument for the loop is that a
worker who has just built wave five is the cheapest builder of wave six — which
is true only within one plan. `--next` already accepts a slug, so the scope
costs nothing.

Where the plan has no further wave, the worker exits and the freed slot is what
lets auto-dispatch start a session on a different plan — under the cap, which is
where cross-plan work belongs.

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

### The registry holds the worker, so the worker can move

A worktree holds one branch, so a worker taking a second branch needs a second
worktree. The obstacle is not the process — it is where Plot records the process.

**Today the anchor is the worktree.** `plot-dispatch.sh:942` writes
`$wt/.plot-worker.pid`; `plot-worker-state.sh:322` reads
`$wt/.plot-worker.pid` for whatever worktree it is handed, and everything
upstream asks per worktree. A worker that walked into a second worktree would
still be recorded in the first.

**The registry already holds the same fact, better.** A manifest carries
`session`, `branch`, `worktree` and `pid` in ONE record — read from a live
manifest, 2026-08-24:

```json
{ "session": "090c9eb1-…", "branch": "feature/the-sprint-file-names-its-members",
  "worktree": "/…/plot-wt-feature-the-sprint-file-names-its-members",
  "pid": "63817", "startedAt": "2026-08-24T08:31:25Z" }
```

The worktree pid file duplicates a fact the manifest already keeps. Move the
anchor there and the worker is free to move: an agent session becomes a thing
that HAS a worktree rather than a thing that lives in one, and transferring it is
one field update — `worktree` and `branch` change, `session` and `pid` do not.

`plot-worker-state.sh` gains the worktree→session lookup and reads the pid from
the manifest. It is a single function with a single file read
(`plot-worker-state.sh:322`), sourced by both `plot-dispatch.sh` and
`plot-fleet-scan.sh`, so the anchor moves in one place for every caller — the
reason that duplication was collapsed into one function in the first place.

**This is the change that makes the loop real.** With the anchor in the registry,
the worker is genuinely one long-lived session moving between worktrees: the
process persists, its context persists, and the fleet can say which worktree it
is in right now. Without it the loop degrades to a hand-off that reuses nothing.

**Three readers must move together**, and the artifact rebuild carries the
fourth:

| reader | what changes |
|---|---|
| `plot-worker-state.sh` | reads the pid from the manifest, not `$wt/.plot-worker.pid` |
| `plot-dispatch.sh` | writes the pid to the manifest; the wrapper's `wait` still records an exit, keyed by session |
| `plot-fleet-scan.sh` | asks by session; it already sources the state function |
| board `/api/continue` | starts a continuation against a session rather than a worktree path |

**The exit marker stays per worktree.** `.plot-worker.exit` records what happened
to a run in a place, and a worker that has moved on leaves a true record of what
it finished there. It is the pid — the claim about what is alive NOW — that
belongs to the session.

### What the worktree anchor gave for free, and the registry must earn

Moving the anchor takes on two properties the current design gets from the
filesystem. Both are already visible in this repo's manifests, so neither is
hypothetical.

**A manifest outlives its worktree.** Manifests live in
`$repo_root/.plot/agents` (`plot-dispatch.sh:864`) — the MAIN repo, which is why
every worktree can reach one directory. But `$wt/.plot-worker.pid` is deleted
when its worktree is, so today a removed worktree takes its claim with it.
A manifest does not.

Measured 2026-08-24: **2 of 5 manifests name worktrees that no longer exist**,
both removed hours earlier when their PRs merged. The registry synthesizes from
worktrees, so those entries currently vanish from the fleet by luck — the
worktree is gone, so nothing enumerates them. Once the pid is read from the
manifest, they must be reaped deliberately.

**The reap rule is the one in the sibling plan.** A manifest whose worktree is
gone and whose pid is dead describes nothing and is deleted. A manifest whose
worktree is gone but whose PID IS ALIVE is a worker that moved — that is the
whole feature, and it must not be mistaken for an orphan. The two are told apart
by `kill -0`, not by the worktree's existence, which is exactly the inversion
this re-anchoring makes possible.

**A pid can be reused by the operating system.** `plot-worker-state.sh:329`
already refuses pid 0 and non-numeric junk, but a recorded pid that a LATER,
unrelated process now holds reads as `running` forever. In the worktree design
the window is small: the file dies with the worktree. In the registry design a
manifest can sit for weeks.

`startedAt` closes it: a pid whose process began before the manifest's
`startedAt` is not that worker, whatever its number. The manifest already
carries the field — all five here have one — and the check is one comparison
against the process's own start time. Without it, all five dead pids in this
repo today are one `fork()` away from reading `running`.

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

### Anchored (Branch: infra/the-registry-holds-the-worker-pid, PR: #390)
- the pid moves from `$wt/.plot-worker.pid` to the session's manifest;
  `plot-worker-state.sh` resolves worktree→session and reads it there; dispatch,
  the scan and the board's continuation follow. The pid is trusted only where
  the process started at or after the manifest's `startedAt`, so a reused pid
  cannot read as `running`. No behaviour changes otherwise — the same states
  from a different anchor, which is what makes it separately verifiable.

### Counted (Branch: feature/the-cap-gates-auto-dispatch, PR: #399)
- `maybeAutoDispatch` refuses at the cap and names the branches holding the
  slots; `plot-dispatch.sh` warns and proceeds

### Asked (Branch: feature/a-worker-asks-for-the-next-wave, PR: #402)
- the `Worker command` loops: implement, ask `--next`, claim, move, implement;
  exit cleanly when `--next` has nothing

### Followed (Branch: feature/the-registry-follows-a-hopping-worker)
- the manifest records the branch a worker moved to and how many waves it has
  taken, so the registry names where a worker IS

## Done when

1. **The pid is read from the manifest and no longer from the worktree.**
   `plot-worker-state.sh` returns the same six process states it does today,
   asserted against the existing tests — the anchor moves, the answers do not.
2. **A worker whose wave lands takes the next eligible wave of the same plan
   without a new session being started.** Demonstrated end to end in a sandbox
   repo with a two-wave plan: one dispatch, two waves implemented, **one pid**
   — asserted on the pid, since that is what distinguishes a moved session from
   a fresh spawn.
2b. **The manifest names the worktree the worker is in NOW**, not the one it
   started in, and `session` and `pid` are unchanged across the hop.
2c. **A manifest whose pid names a process older than its `startedAt` reads as
   stopped, not running.** Asserted directly — this is the pid-reuse case the
   worktree anchor made rare and the registry anchor makes durable.
2d. **A manifest whose worktree is gone and whose pid is dead is reaped; one
   whose worktree is gone and whose pid is ALIVE is reported as a worker that
   moved.** Two of five manifests here are already in the first state.
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
