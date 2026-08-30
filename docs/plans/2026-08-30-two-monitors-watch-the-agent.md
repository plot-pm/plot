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

### How a monitor reports: it publishes to a channel

**The monitor polls so that nobody else has to.** That is the whole trade, in
one sentence: polling a process for its CPU clock and a host for a PR is
unavoidable — those facts have to be gone and fetched — so exactly one component
does it, and everyone else subscribes.

**Any number of interested parties subscribe; none of them poll anything.** The
board renders the findings, the master agent acts on them, and a third consumer
tomorrow needs no change to either the monitor or the other subscribers. **The
polling cost stays at one, whatever the number of subscribers** — which is the
property a file, read once per reader per pulse, cannot have.

**An earlier draft had them writing files the scan would read, and that was
wrong on the numbers.** Measured 2026-08-30:

| | |
|---|---|
| worktrees on this machine | **24** |
| files the scan already reads per worktree | 4 |
| files the file design would have added | **2 per worktree — 48 more** |
| scan duration against the board's 5 s cadence | **18.3 s** |

**It would have polled the same fact twice.** The WorkerMonitor already samples
every ~30 s — that IS the poll. Having the scan then read the file it wrote is a
second poll for an answer already computed, on a scan that does not fit its
cadence today. **The monitor exists to remove the need to go looking, and a file
that must be looked at reinstates it.**

**And it would have scattered the state.** 48 files across 24 worktrees is 48
things to find, age-check and reconcile — and a master agent wanting fleet
health would have had to walk every worktree. A channel is one thing to
subscribe to, and it knows its own subscribers.

**Channel, not queue.** Findings are current state, not events to replay: a
subscriber joining late wants what is true now, not the history of what was.
So a subscriber receives the current findings on connect and updates thereafter
— the same shape the board's pulse already has, pushed instead of polled.

**Two subscribers today, and they are the reason it is a channel rather than a
return value:** the board renders it, the master agent acts on it, and neither
should have to know the other exists. **A return value serves one caller; a
channel serves whoever asks**, and the second subscriber costs nothing — no
extra sampling, no second poll, no coordination between them.

> **The streaming precedent is already here.** `plot-fleet-scan.sh --stream`
> emits per-plan lines as it resolves, precisely because 18.3 s against a 5 s
> cadence makes waiting structural. The monitors are that argument taken one
> step further: do not make anyone wait for a sweep to learn something the
> monitor already knew.

**What a dead monitor looks like on a channel**, since this is what the file
design's `sampled` field was for: the monitor holds its subscription, so losing
it IS the signal. A subscriber sees the connection drop rather than having to
notice a timestamp going stale — and that is stronger, because a stale file
still parses and still answers.

### What a report contains

**A finding, a measurement, and when it was taken** — the third being what makes
a stale report detectable rather than misleading.

| field | why |
|---|---|
| `finding` | one of the named states, or empty for nothing to say |
| `since` | when this finding first held, so age is readable |
| `evidence` | the measurement behind it: the CPU delta, the missing PR, the marker path |

**`evidence` is not decoration.** Every finding here is an anded set of facts,
and a reader deciding whether to act needs to know which one fired. *"Owes a
review"* with `evidence: 4 commits ahead, no PR` is actionable; the word alone
is a claim someone has to re-derive.

**Three fields, not four.** A file design needed a `sampled` timestamp so a
reader could tell a current answer from an abandoned one. A channel does not:
the monitor holds the subscription, so a monitor that stops is a connection that
drops, and no consumer has to age-check anything.

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
| publishes | on change, immediately | on change, immediately |
| **worst case, event to screen** | **~60 s** | **~5 min** |

**Publishing on change rather than on a tick is what the channel buys.** The
file design added the board's 5 s pulse on top of every sample interval; here a
finding leaves the monitor the moment it holds. The remaining latency is the
sampling itself, which is a property of the measurement rather than of the
transport.

**Nothing is published when nothing changed.** A subscriber that hears nothing
is looking at a fleet where nothing changed — and if the monitor itself has
gone, the subscription drops, which is a different silence and a distinguishable
one.

**The AgentMonitor's five minutes is a host budget, not caution.** Its findings
need a PR lookup, and this repository already measured what happens when host
questions ride a fast loop. Five minutes against a stall that lasted 50 makes it
visible 45 minutes earlier than a person asking — the saving is in the order of
magnitude, not the seconds.

**The WorkerMonitor's two-sample rule is what stops it crying wolf.** A single
idle reading is a process between syscalls. Two, a minute apart, over a tree
that did not change, is a process that has stopped.

**A monitor that stops is visible without a heartbeat**, because it holds the
subscription: the connection drops. That is the file design's `sampled` field
made structural — a stale file still parses and still answers, while a dropped
subscription cannot be mistaken for a healthy one.

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
and **it publishes the moment a finding holds and publishes nothing when
nothing changed**, carrying `finding`, `since` and `evidence`.

**That last clause is the one that keeps the cadences apart.** A WorkerMonitor
that asks the host has become an AgentMonitor with a fast loop, and the rate
problem follows.

### Watching the agent (Branch: feature/the-agent-monitor-reads-the-desk)

The AgentMonitor: `owes a review`, `owes an answer`, `holds unlanded work`, read
from the desk and the host on a slow cadence. Built on `plot-worker-state.sh`
and `plot-pr-merged.sh`.

**Done when** each of the three findings is individually triggerable in a test,
`owes a review` fires on a branch with commits and no PR and does NOT fire once
a PR exists, it publishes on change with the same three fields,
and **it writes nothing at all** — publishing is its only output.

### Reporting (Branch: feature/the-channel-carries-the-findings)

The channel itself: monitors publish, the board and the master agent subscribe.
Attention derives its entries from what the board received.

**Done when**

- a subscriber joining late receives the current findings, not a replay
- an `owes a review` branch appears on the attention surface, the entry names
  the branch and what to do, and it clears when the PR is opened
- a WorkerMonitor `idle` finding is distinguishable from an AgentMonitor one
- **two subscribers each receive every finding**, and neither needs to know the
  other exists
- **a monitor that dies drops its subscription**, and a subscriber can tell that
  from a monitor with nothing to say

**The last two are the ones a channel has to earn.** One subscriber is a return
value; two is a channel. And silence-because-healthy versus silence-because-gone
is the distinction the whole design rests on — if a subscriber cannot tell them
apart, the monitor has the same blind spot as the agent it watches.

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
