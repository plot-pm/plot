# Two monitors watch the agent

> One watches the process and one watches the desk, on cadences that cannot be shared — so a dead agent, an idle process, and finished work with no PR are all reported instead of discovered.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** the-domain-is-one-implementation
- **Issue:** <!-- optional -->
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Approved:** <!-- YYYY-MM-DD, who, channel -->
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Changelog

- A dispatched agent is watched by two monitors — one on its process, one on its desk — so finished work with no PR, an idle process and a dead agent are reported on the board's attention surface rather than found by someone looking.

<!-- Board impact: YES — new attention entries. The pulse contract gains fields;
     no existing value changes. Rebuild the artifact. -->

## Motivation

**Twice in one session, finished work sat on a branch with no PR, and nothing
noticed.**

| | how it died | what was there |
|---|---|---|
| `feature/the-ports-have-adapters` | exited cleanly | 4 commits, 7 ports, 261 tests green |
| `feature/the-domain-agrees-with-production` | process alive, agent gone | 4 commits, corpus tier, 13/13 green |

**Both were found because a person asked.** Nothing in Plot reports *this branch
has finished work and no review* — not the scan, not the board, not the worker
state.

**The second one is the sharper case, because the process lied.**
Measured 2026-08-30: **50 minutes elapsed, 0.01s CPU**, children `bash` only.
The pid was alive, so every check that asks *is a worker running?* said yes. Had
the answer been trusted, that work would still be sitting there.

**The signals already exist; nothing asks them on a cadence and nothing reports
the answer.**

- `plot-worker-state.sh` knows eight states and refines `finished` by the tree
- `plot_worker_activity()` samples subtree CPU over 0.4 s and returns
  `working` / `idle` — the exact signal that would have caught the stall
- `attention.ts` is already the surface for *this needs you*

**And a monitor that can be forgotten is one that will be.** Both measured
failures happened on dispatched agents — the path Plot fully controls. If
monitoring is something a dispatcher may or may not set up, the next stalled
agent will be one nobody attached a monitor to, and the finding will be that the
monitor was missing rather than that the agent was. **So every worker is born
monitored, and the monitor is structurally unable to die first** — see
*Attaching* below.

**What is missing is the middle: something that asks regularly, compares this
answer with the last, and speaks when the comparison is bad.** A single reading
cannot distinguish a worker thinking from a worker gone; two readings, minutes
apart, can.

## Design

### It observes; it does not act

**The monitor writes attention entries and changes nothing else.** It does not
kill a process, open a PR, reap a worktree or restart an agent — every one of
those is a judgement with a blast radius, and `plot-reap.sh` and
`plot-dispatch.sh` already own them behind their own refusals.

**That boundary is what makes it safe to run continuously.** A watcher that can
only report is one nobody has to supervise.

### Two monitors, because there are two subjects

**A WorkerMonitor and an AgentMonitor, and the split is not stylistic.**
CLAUDE.md settles it for new code: *"a state answering what is the process
doing? goes on the worker; one answering what does this agent owe, or still
hold? goes on the agent."* The findings divide exactly along that line, and
they divide by **what they sample**:

| monitor | samples | cadence | answers |
|---|---|---|---|
| **WorkerMonitor** | the process table | seconds | is this process doing anything? |
| **AgentMonitor** | the desk and the host | minutes | does this agent still owe something? |

**They cannot share a cadence, which is the practical reason they are two.**
CPU delta is meaningless unless sampled close together — `plot_worker_activity()`
uses 0.4 s. Whether a branch has a PR is a host round trip, and asking it every
few seconds would be the rate problem this repository already measured at 127
git processes per scan. One subject wants tight sampling of a cheap fact; the
other wants occasional sampling of an expensive one.

#### WorkerMonitor — what the process is doing

| finding | measurement |
|---|---|
| **idle** | pid alive, CPU delta zero across consecutive samples |
| **gone** | pid dead |

**`idle` is deliberately not called `stalled`.** The spec already uses that word
for an **Agent** fact — *"exited 0, unlanded work, no PR"*
([DESIGN-agent.md](../stories/the-master-agent-holds-the-fleet/DESIGN-agent.md)) —
and an earlier draft of this plan reused it for a live process with no CPU.
Those are different states with different remedies: a `stalled` agent has work
to rescue, an `idle` worker may simply be waiting on a network call. Reusing the
name would have put a process fact on the agent side, which is the exact
confusion CLAUDE.md's rule exists to prevent.

#### AgentMonitor — what the agent owes

| finding | measurement |
|---|---|
| **owes a review** | tree clean, commits ahead of the default branch, no PR |
| **owes an answer** | a `PLOT-BLOCKED*` marker in the tree |
| **holds unlanded work** | uncommitted or unpushed changes in the tree |

**Each is a measurement, not a judgement** — the same discipline `plot-reap.sh`
applies to its five refusals. *"Owes a review"* is three facts anded together,
and every one is checkable by a script.

#### The two measured cases need both

`the-ports-have-adapters` is an **AgentMonitor** finding: the worker exited
correctly, and what was wrong was the debt it left. `the-domain-agrees-with-production`
is a **WorkerMonitor** finding first — 50 minutes at 0.01s CPU, while the pid
said running — and becomes an AgentMonitor finding the moment that process is
ended. **A single monitor would have had to sample the host every few seconds to
catch the first, or wait minutes to catch the second.**

### How a monitor reports: a file, read by the scan. No channel.

**There is no subscription, and adding one would be a second transport beside a
working first.** Everything a worktree tells the fleet today travels the same
way: the monitor writes a file in the worktree, and the scan reads it on the
next pulse. `plot-worker-state.sh` already reads exactly four —
`.plot-worker.pid`, `.plot-worker.exit`, `.plot-worker.log`,
`.plot-worker.wrapper` — and the board polls every 5 s with no SSE, no
WebSocket, and nothing subscribing to anything.

**Two files, one per monitor**, following the naming already in use:

```
.plot-worker.activity   what the process is doing   written by the WorkerMonitor
.plot-agent.debt        what the agent owes         written by the AgentMonitor
```

**Each write is a whole-file replace of the current answer, not an append.**
The file holds *what is true now*, so a reader never parses a history and a
crashed monitor leaves the last honest answer rather than a truncated line.
The log is the place for history and already exists.

**This is Manifesto Principle 1 rather than a convenience.** The fleet is
stateless and re-derived — the scan asks git every pass and discards a cached
entry the moment it disagrees. A subscription would make the board hold state
the monitor pushed, which is a record; a file the scan re-reads every pulse is a
derivation, and a monitor that dies stops updating a file rather than silently
failing to deliver.

**Nothing new is invented for delivery.** `worker_activity` already travels this
route: `plot_worker_activity()` measures it, the scan carries it on the branch
row, and `schema.ts` documents it as *"forwarded onto the row unchanged"*. The
monitors' findings ride the same rails.

### What a report contains

**A finding, a measurement, and when it was taken** — the third being what makes
a stale report detectable rather than misleading.

| field | why |
|---|---|
| `finding` | one of the named states, or empty for nothing to say |
| `since` | when this finding first held, so age is readable |
| `sampled` | when it was last confirmed — a monitor that stopped is visible |
| `evidence` | the measurement behind it: the CPU delta, the missing PR, the marker path |

**`evidence` is not decoration.** Every finding here is an anded set of facts,
and a reader deciding whether to act needs to know which one fired. *"Owes a
review"* with `evidence: 4 commits ahead, no PR` is actionable; the word alone
is a claim someone has to re-derive.

**An empty finding is written too.** A file saying *"sampled at T, nothing to
report"* is different from a file nobody has written since T-40min, and the
difference is the whole point of monitoring — see the timing table below.

### The cadence, and why it is not the pulse

**The board pulses every 5 s; the monitor samples far slower.** A stall is only
visible over minutes — CPU delta across two samples 0.4 s apart says whether a
process is busy *now*, which is noise on its own. What identifies a stall is
*idle across successive samples while the tree has not changed*.

**So the monitor keeps the previous answer.** That is the one piece of state
here, and it is derived rather than recorded: lose it and the next sample
rebuilds it, at the cost of one interval's delay.

#### When each report appears, end to end

| | WorkerMonitor | AgentMonitor |
|---|---|---|
| samples every | ~30 s | ~5 min |
| a finding needs | 2 consecutive samples | 1 sample |
| written to | `.plot-worker.activity` | `.plot-agent.debt` |
| reaches the board after | the next pulse (≤ 5 s) | the next pulse (≤ 5 s) |
| **worst case, event to screen** | **~65 s** | **~5 min** |

**The AgentMonitor's five minutes is a host budget, not caution.** Its findings
need a PR lookup, and this repository already measured what happens when host
questions ride a fast loop. Five minutes against a stall that lasted 50 makes it
visible 45 minutes earlier than a person asking — the saving is in the order of
magnitude, not the seconds.

**The WorkerMonitor's two-sample rule is what stops it crying wolf.** A single
idle reading is a process between syscalls. Two, a minute apart, over a tree
that did not change, is a process that has stopped.

**Both write on every sample, finding or not.** That is what makes `sampled`
meaningful: a consumer can tell *"nothing wrong 20 s ago"* from *"nobody has
looked in 40 minutes"*, and the second is itself a finding — the monitor that
was supposed to be unable to die first has stopped writing, and something is
wrong with the assumption rather than the agent.

### Attaching, and why it cannot be optional

**Every worker gets a monitor at creation, and every agent gets one too. The
monitor must not die before its subject.**

**`start_worker()` is the single place a worker comes into existence**, and
CLAUDE.md already names it as such: *"it starts through `start_worker`, so the
manifest is written by one writer and the fleet can see what it started."* A
monitor attached anywhere else is one that can be skipped; attached there, a
worker without a monitor is unreachable rather than discouraged.

#### The monitor lives INSIDE the wrapper, not beside it

**This is the part that makes "never dies first" enforceable rather than
hoped-for**, and the mechanism already exists and is already proven.

`plot-dispatch.sh` does not spawn the agent directly. It spawns a `sh -c`
**wrapper**, which backgrounds the agent, records its pid, `wait`s for it, and
writes `.plot-worker.exit` when it exits — with both pids kept separately
(`.plot-worker.pid` for the agent, `.plot-worker.wrapper.pid` for the wrapper).
The comment at `plot-dispatch.sh:469` states the property outright: *"`--stop`
kills the agent, the wrapper survives to record the code."*

**So the wrapper ALREADY outlives its agent, by construction, because otherwise
there would be no exit code.** The monitors run in that wrapper:

```
wrapper  ── backgrounds ──► agent          (the work)
         ── runs        ──► WorkerMonitor  (samples the agent's pid)
         ── runs        ──► AgentMonitor   (samples the desk)
         ── waits for   ──► agent, then records the exit
```

**A sibling process would have been the wrong shape.** Two processes started
side by side are independently mortal: the monitor can be killed, OOM-ed or
crash, and nothing notices — which is precisely the failure being fixed, one
level up. Inside the wrapper the monitor cannot outlive its usefulness or die
early without the wrapper dying, and a dead wrapper is already a state the fleet
reads.

#### What "enforced" means here, precisely

**Two gates, because there are two claims:**

| claim | gate |
|---|---|
| a worker is never created without monitors | `start_worker()` starts them; there is no other path to a worker |
| a monitor never dies before its subject | the monitor is the wrapper's child, and the wrapper must outlive the agent to write the exit file |

**The second is not a rule anyone follows — it is structural.** Ask CLAUDE.md's
test: *can you answer "did I complete this?" without doing the work?* For "did I
attach a monitor", inside `start_worker()` you cannot: no monitor, no worker.

**What it does NOT guarantee, stated:** if the whole wrapper is `kill -9`-ed, the
agent, both monitors and the exit record go together. That is not a monitoring
gap — a process tree that vanishes at once leaves a worktree the fleet scan
already reads as `ended` with no exit file. The monitors exist for the case where
the subject misbehaves, not for the case where the machine takes everything.

#### A hand-made worktree gets none

Deliberate. Attaching to everything would mean watching worktrees nobody
dispatched — the population `plot-dispatch.sh` already refuses to reason about,
because they carry no claim and follow no naming. **They also have no wrapper**,
so there is nothing for a monitor to be a child of.

## Slices

### Watching the worker (Branch: feature/the-worker-monitor-samples-the-process)

The WorkerMonitor: `idle` and `gone`, sampled from the process table on a tight
cadence, with the previous answer kept so `idle` needs two readings rather than
one. Built on `plot_worker_activity()` rather than beside it.

**Done when** a single idle sample reports nothing, two consecutive idle samples
over an unchanged tree report `idle`, a tree that changed between samples resets
the comparison, a dead pid reports `gone`, the monitor makes no host call at all,
and **every sample rewrites `.plot-worker.activity` whole — including the ones
with nothing to report**, carrying `finding`, `since`, `sampled` and `evidence`.

**That last clause is the one that keeps the cadences apart.** A WorkerMonitor
that asks the host has become an AgentMonitor with a fast loop, and the rate
problem follows.

### Watching the agent (Branch: feature/the-agent-monitor-reads-the-desk)

The AgentMonitor: `owes a review`, `owes an answer`, `holds unlanded work`, read
from the desk and the host on a slow cadence. Built on `plot-worker-state.sh`
and `plot-pr-merged.sh`.

**Done when** each of the three findings is individually triggerable in a test,
`owes a review` fires on a branch with commits and no PR and does NOT fire once
a PR exists, every sample rewrites `.plot-agent.debt` whole with the four fields,
and **nothing in it writes outside that one file**.

### Reporting (Branch: feature/the-monitor-reaches-attention)

The scan reads the two files and carries their findings on the branch row, the
way it already carries `worker_activity`; attention derives its entries from
there.

**Done when** an `owes a review` branch appears on the attention surface, the
entry names the branch and what to do, it clears when the PR is opened, a
WorkerMonitor `idle` finding is distinguishable from an AgentMonitor one in the
entry itself, and **a file whose `sampled` is older than three of its own
intervals reads as a stopped monitor rather than as its last finding**.

**That last one is the assertion that keeps a dead monitor from looking
healthy.** A stale file still parses; without an age check its last answer would
be served forever as though it were current.

### Attaching (Branch: feature/every-worker-is-born-monitored)

`start_worker()` starts both monitors inside the wrapper, before the agent.

**Done when**

- a dispatched agent gets both monitors without the operator asking
- **there is no code path that creates a worker without them** — asserted by the
  test below, not by review
- killing the agent leaves both monitors alive long enough to record the finding,
  and the wrapper still writes `.plot-worker.exit`
- a hand-made worktree gets neither
- `--dry-run` names which monitors it would attach to which worktree

**The test is a mutation and an ordering assertion, because a review cannot see
either.** Removing the monitor start from `start_worker()` must turn a test red —
that is the "no other path" claim. And `--stop`, which kills the agent, must
leave the monitors and the exit file intact — that is the "never dies first"
claim, checked against the thing that would break it.

**Watch the startup window.** `plot-dispatch.sh:478` records a sub-millisecond
gap where the wrapper has started and `.plot-worker.pid` is not yet written, and
a scan landing there reads `none` — honest. The monitors start inside the same
wrapper, so they inherit that window rather than widening it: a monitor must not
report `gone` from a pid file that has not been written yet.

## Notes

**This does not replace reading the board.** It changes what the board can tell
you: today a finished-no-PR branch is indistinguishable from one still being
worked on, and after this it is not.

**The two measured cases are the acceptance test.** If the monitor had been
running, `the-ports-have-adapters` would have reported `finished, no PR` within
one interval of the worker exiting, and `the-domain-agrees-with-production`
would have reported `idle` after two samples — and, once that process was
ended, `owes a review` from the other monitor. Neither needed a person to ask.

**Open: what the master agent does with a report.** Reporting to the board is
this plan; an agent that acts on the report — restarting, reaping, opening the
PR — is the next question, and it needs the controller
([`the-controller-answers-every-asker`](2026-08-30-the-controller-answers-every-asker.md))
to ask through. Deliberately not here: a watcher that acts is a different risk
from one that reports.
