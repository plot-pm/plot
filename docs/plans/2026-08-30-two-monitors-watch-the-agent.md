# Three monitors watch the work

> One watches the process, one the desk, one the build — on cadences that cannot be shared — so a dead agent, an idle process, finished work with no PR, and a build nobody is waiting on are reported instead of discovered.

## Status

- **Phase:** Approved
- **Type:** feature
- **Sprint:** the-domain-is-one-implementation
- **Issue:** <!-- optional -->
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-30, Jan Wloka, in-session
- **Amended:** 2026-08-30, Jan Wloka, in-session — a third monitor for the Build; 6 slices → 7
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->
- **Started:** 2026-08-30, Jan Wloka, `feature/every-worker-is-born-monitored`
- **Started:** 2026-08-30, Jan Wloka, `feature/the-worker-monitor-samples-the-process`
- **Started:** 2026-08-30, Jan Wloka, `bug/a-monitor-ends-with-its-agent`

## Approval

- **Assignee:** Jan Wloka

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
| **idle** | pid alive, CPU delta zero across consecutive samples, **tree unchanged, and commits already present** |
| **gone** | pid dead |

**`idle` carries three conditions, not one, because a thinking agent looks like
a dead one.** A worker waiting on a long model response has the same zero CPU
delta as a worker whose agent has vanished. What separates them, measured across
the three stalls this session, is that each had **already committed** and then
gone quiet — work delivered, then silence.

**Measured 2026-08-30, and it breaks the condition as implemented (#538 red):**
`monitor_has_commits` counts `origin/main..HEAD`, and **the dispatcher writes a
claim commit before the agent starts**:

```
infra/a-log-lives-under-worktrees      first commit: "plot: claim infra/a-log-lives-..."
feature/the-worker-monitor-samples-...  first commit: "plot: claim feature/the-worker-..."
```

So *commits present* is true from second zero on **every** dispatched branch,
and the condition distinguishes nothing. The CI failure is the proof: a worker
burning CPU in `yes > /dev/null` was reported `idle`, because the only condition
that could have saved it was already satisfied by the claim.

**What the plan means is the agent's work, not the dispatcher's bookkeeping** —
*"it produced work and stopped"*. The fix is to count commits **after the
claim**, not after `origin/main`. The claim is the branch's first commit and is
written by `plot-dispatch.sh`, so it is identifiable rather than guessed at.

**It passed locally and failed in CI for a reason worth keeping:** locally `yes`
started fast enough to break the CPU condition before the two-sample rule
completed, so the broken fourth condition never got to decide. A slower runner
let it. The test was measuring the CPU condition and believed it was measuring
all four.

| | idle fires |
|---|---|
| no CPU, tree unchanged, **commits present** | yes — it produced work and stopped |
| no CPU, tree unchanged, no commits yet | no — it may be thinking about the first one |
| no CPU, **tree changed** between samples | no — something is happening |

**The middle row is where the false positives would have been.** An agent given
a hard first slice is quiet for a long time and has nothing to show yet; calling
that a stall teaches an operator to ignore the finding.

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
| **owes a gate** | commits ahead, and a repo gate the branch does not satisfy |
| **owes an answer** | a `PLOT-BLOCKED*` marker in the tree |
| **holds unlanded work** | uncommitted or unpushed changes in the tree |

**`owes a gate` exists because the third stall fell through the other three.**
Measured 2026-08-30: `feature/the-workflows-decide-without-acting` had commits,
a clean tree and no marker — and **no changeset**, so it would have landed red.
Every finding above said nothing.

**It starts with the changeset, because that is the gate that was missed** and
the one a script can check without running CI: a branch with commits and no new
`.changeset/*.md`. CI has ten more, and the monitor does not run them — running
CI to predict CI is a second CI.

**What it must not become is a CI reimplementation.** The rule: a gate belongs
here only if it can be answered from the worktree alone, in the time the
AgentMonitor already spends. The changeset qualifies; *"do the tests pass"* does
not, and asking it would turn a five-minute sample into a build.

**Each is a measurement, not a judgement** — the same discipline `plot-reap.sh`
applies to its five refusals. *"Owes a review"* is three facts anded together,
and every one is checkable by a script.

#### A third monitor: the Build

**Two monitors became three, and the reason is the same one that split the first
two: a different subject on a different cadence.**

| monitor | subject | samples | asks |
|---|---|---|---|
| **WorkerMonitor** | the process | ~30 s | is it doing anything? |
| **AgentMonitor** | the desk | ~5 min | what does this agent owe? |
| **BuildMonitor** | the run | ~30 s **while a run is live**, never otherwise | did the build change? |

**A Build is already an entity in the spec**, with its own identity and its own
state:
[DESIGN-build.md](../stories/the-master-agent-holds-the-fleet/DESIGN-build.md)
— *"is the thing that RUNS … one RESULT of one run"*, identified by its URL,
holding a state, a start time and a duration. **A monitor per entity is the
pattern, not an exception to it.**

**Its findings are transitions, not conditions:**

| finding | measurement |
|---|---|
| **build failed** | a run for this branch's head reached a failing conclusion |
| **build passed** | it reached success |
| **build needs approval** | it is `action_required` — a real state here, bot branches hit it |
| **head moved** | a newer sha exists, so the run in flight is answering about the past |

**The last one is why this cannot live in the AgentMonitor.** A build's subject
is a *sha*, not a branch, and a finding about a superseded run is worse than
none — it reports green for code nobody will merge. Measured this session: two
merge waiters had to be stopped and re-armed for exactly that.

**It samples only while a run is live**, which is what keeps a 30-second cadence
affordable against a host. No run, no polling. **The AgentMonitor's five-minute
budget exists because it asks on every pass; this one asks nothing when nothing
is running.**

**This is where *tell me when CI is green* belongs**, and the channel refuses it
until this monitor exists — the plan says so explicitly, and this is the
component that lifts the refusal rather than a reason to weaken it.

**Measured need: eleven hand-written polling loops in the session that wrote this
plan**, most of them waiting on a build. Each re-implemented approval-retry,
head-movement detection and sha pinning, and each got at least one of them
wrong at first.

#### An agent outlives its slice, so a finding names the SLICE

**An agent takes one unit at a time and then takes another.**
[DESIGN-agent.md](../stories/the-master-agent-holds-the-fleet/DESIGN-agent.md)
says it plainly — *"slice merged ─► agent and desk are FREE for the next unit"* —
and that is why `branch` is optional on an agent: one between units genuinely
has none.

**So "this agent owes a review" is the wrong sentence.** By the time the finding
is read, the agent may be three commits into its next slice, and the debt
belongs to a branch it has left behind. A report naming the agent would send
someone to a desk where nothing is wrong.

**Every AgentMonitor finding names the slice it is about**, and the agent only
as *who was at that desk when it happened*:

```
owes a review   feature/the-ports-have-adapters   4 commits, no PR
                (agent 0a3f, which has since moved to feature/…)
```

**The debt outlives the agent's attention, which is the entire point.** The
three measured cases are exactly this: work finished on a branch, the agent gone
or moved on, and nothing pointing at the branch.

#### When the monitor does its job, given an agent that keeps going

**The WorkerMonitor's subject is the process and it never stops** — the pid is
alive whether the agent is on its first slice or its fifth, and `idle` means the
same thing throughout. Nothing changes across a unit boundary.

**The AgentMonitor's subject is a desk, and a desk holds one branch at a time.**
It reads the worktree: which branch is checked out, what is committed, what the
host says about it. When the agent moves to the next unit, the desk moves with
it — so the AgentMonitor follows the current branch, and a *previous* branch's
debt does not vanish because the branch is still there with commits and no PR.

**That is why the finding is keyed by branch rather than by worktree.** A
worktree that has moved on reports on what it holds now; the branch it left is
still a branch the fleet scan sees, and its debt is still true. **The monitor
does not have to catch the moment work finishes** — the debt persists until a PR
exists, so a finding one interval late is as good as one on time.

**The registry's own question is different and stays separate.** DESIGN-agent.md
distinguishes `state` (*what is the process doing*) from **availability**
(*can this agent take a slice*), and says no state answers the second. The
monitors report the first two rows of that table; whether an idle agent should
be given work is the registry's call, made from the state plus its slice. **A
monitor that also decided availability would be answering a question the spec
gives to something else.**

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

**An earlier draft had them writing files the scan would read.** Rejected on the
numbers: 24 worktrees × 2 files is 48 more things to age-check, the scan already
takes 18.3 s against a 5 s cadence, and the WorkerMonitor's own 30 s sample IS
the poll — having the scan read the file it wrote polls the same fact twice.
The reasoning is in the commit that made the change.

**Channel, not queue.** Findings are current state, not events to replay: a
subscriber joining late wants what is true now, not the history of what was.
So a subscriber receives the current findings on connect and updates thereafter
— the same shape the board's pulse already has, pushed instead of polled.

#### It lives on the Machine, which is why this is local and not networked

**Everything runs on one machine, and the spec says so as a property rather
than an assumption**:
[DESIGN-machine.md](../stories/the-master-agent-holds-the-fleet/DESIGN-machine.md)
— *"There is exactly one Machine, and that singularity is…"*, and *"One machine,
and the supervisor is on it."* The Machine has no identity **because there is
only one**.

**So the three processes — monitor, board, master agent — are neighbours, not
peers across a network.** The channel is a socket under `.plot/`, and that
choice follows from the Machine rather than from preference:

| | why not |
|---|---|
| HTTP to the board | requires a board to be running. Measured 2026-08-30: none was. Seven skills would gain a dependency on a service that has always been optional |
| a port | a port is how you reach another machine; there is only one |
| a queue broker | infrastructure for a problem that does not cross a host boundary |

**A local socket needs no board, no port and no configuration.** It is present
whenever the repository is, which is the same availability the worktree files
have today — without their cost, because one socket serves every subscriber and
the monitors write it once.

**The wrapper can reach it, and that is the constraint that decided it.**
`plot-dispatch.sh:275` calls the wrapper *"a fresh shell that cannot reach"* the
dispatcher — it inherits no state, no descriptors, no environment beyond what is
passed. A filesystem path is exactly what such a shell CAN reach.

**Two subscribers today, with different purposes, and that is the reason it is a
channel rather than a return value:** the board subscribes to *everything* and
renders it; the master agent subscribes *until a condition holds* and acts.
Neither knows the other exists, and the second costs nothing — no extra
sampling, no second poll, no coordination.

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

### A subscriber subscribes with a purpose

**Subscribing is not "send me everything". A subscriber says what it is there
for, and hears only that.**

```
subscribe(purpose: everything)                     the board — it renders the fleet
subscribe(purpose: until this branch is merged)    an agent sequencing work
subscribe(purpose: until this worktree is clean)   an agent waiting to reap
```

**The purpose is the subscription, not a filter on top of one.** A subscriber
with a narrow purpose is finished when it is served — the subscription ends
itself, and the monitor stops carrying it. A subscriber whose purpose is
*everything* stays for as long as it listens.

**That one idea covers both kinds of listener** — which is why it is a purpose
rather than two mechanisms. The board and a waiting agent differ in what they
are there for, not in how they connect:

| purpose | ends when | who |
|---|---|---|
| everything | the subscriber disconnects | the board |
| until *&lt;condition&gt;* | the condition holds, once | an agent sequencing work |

**A subscriber stops polling and starts waiting.** It states its purpose once
and hears about it once; the monitor — already sampling — folds the check into a
pass it was making anyway.

#### This replaces work that is being done by hand today

**Measured on this session: eight polling loops written by hand**, all the same
shape:

```bash
for i in $(seq 1 70); do
  ... is CI green? has the PR merged? has the head moved? ...
  sleep 30
done
```

Each was a private poller with its own interval, its own timeout and its own
rate cost — and each asked a question the monitor was about to ask anyway.
**Every one of them would have been a single request.**

**This is the case FOR a channel rather than a return value**, more than
publishing was. A return value serves a caller that wants an answer now; a
purpose serves one that wants an answer *when there is one*. **The board's
purpose is the degenerate case** — *everything*, forever — and that it falls out
of the same mechanism rather than needing its own is what says the mechanism is
the right shape.

#### The conditions are the monitor's existing measurements

**Nothing new is measured**, which is what keeps this from becoming a second
scan:

| condition | already measured by |
|---|---|
| this branch is merged | AgentMonitor's `owes a review` host lookup |
| this worktree is clean | AgentMonitor's `holds unlanded work` |
| this process is gone | WorkerMonitor's `gone` |

**CI-is-green is the one exception, and it is stated rather than assumed.** No
monitor asks the host about a check run today, so *tell me when CI is green*
either adds a measurement to the AgentMonitor's pass or is refused. **It is
refused in this plan**: adding a new host question to satisfy a request is how
the five-minute budget stops meaning anything, and the plan that adds it should
argue for its cost separately.

#### What a request may not do

| | |
|---|---|
| a subscriber may | state a purpose, and be served it |
| a subscriber may not | name a purpose the monitor does not already measure |
| a subscriber may not | poll the monitor — the monitor tells it |
| the monitor may | refuse a purpose it cannot serve, and say which |

**A refused purpose is answered immediately rather than left pending.** A
subscriber waiting forever on a condition nobody is checking is the failure this
replaces, reproduced inside the mechanism meant to end it.

**A purpose dies with its subscriber.** One that disconnects is owed nothing,
and a monitor holding purposes for absent listeners accumulates state it can
never discharge — which is how a component that exists to notice things stops
noticing.

**The direction of polling does not change, and that is the point.** The monitor
still owns every measurement. A subscriber that sampled for itself would put the
host round trip back on a fast loop — the rate problem this design exists to
avoid, arriving by the back door — and a subscriber that waits costs nothing at
all, because the condition rides a pass the monitor was already making.

### What a report contains

**A finding, a measurement, and when it was taken** — the third being what makes
a stale report detectable rather than misleading.

| field | why |
|---|---|
| `finding` | one of the named states, or empty for nothing to say |
| `since` | when this finding first held, so age is readable |
| `evidence` | the measurement behind it: the CPU delta, the missing PR, the marker path |
| `measuredAt` | ISO-8601, **required** — a reading without one cannot be judged stale |

**`evidence` is not decoration.** Every finding here is an anded set of facts,
and a reader deciding whether to act needs to know which one fired. *"Owes a
review"* with `evidence: 4 commits ahead, no PR` is actionable; the word alone
is a claim someone has to re-derive.

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

**A monitor that stops is visible because it stops sending its heartbeat.**
Every sample publishes, finding or not, so silence past one interval is itself
the signal.

**An earlier draft claimed a dropped subscription would show this. It would not — the monitor publishes rather than subscribes, so nothing watches its connection, and a publisher that dies quietly looks exactly like one with nothing to say.**

**So `measuredAt` comes back, and it is the repo's existing pattern rather than
a new one.**
[DESIGN-machine.md](../stories/the-master-agent-holds-the-fleet/DESIGN-machine.md)
makes it **required** on a Machine reading, for exactly this reason: *"a reading
without one cannot be judged stale."* A monitor finding is a reading and gets
the same field.

| | |
|---|---|
| a finding with a recent `measuredAt` | current |
| the same finding, `measuredAt` older than three intervals | **the monitor stopped**, not the finding persisting |
| no finding at all, heartbeat current | genuinely nothing wrong |

**That third row is what the heartbeat buys.** Without it, *"healthy"* and
*"gone"* are the same silence — which is the blind spot the monitors exist to
close, reproduced one level up in the monitors themselves.

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

**Measured 2026-08-30, after the Attaching slice merged (#536): the second gate
does not hold.** 112 monitor processes were found running, in 56 pairs, all in
the Attaching slice's own test worktree, the oldest 1h00m old. Every one of
them reported `ppid=1`:

```
ps -eo pid,ppid,command | grep plot-.*-monitor | awk '{print $2}' | sort -u
  ppid=1   /sbin/launchd
```

Their wrappers are gone. Being a child did not make them mortal — it made them
**orphans**, adopted by init and running on. The main loop is `while :; do sleep
"$interval"; noop_pass; done`, and `plot-dispatch.sh` sets no `trap`, no `kill`
and no `wait` for them.

**The claim was about dying too EARLY, and only that.** "The monitor cannot
outlive its usefulness or die early without the wrapper dying" states a lower
bound on a monitor's life and never an upper one — and the slice's `Done when`
asks the same question in the same direction: *killing the agent leaves both
monitors alive long enough to record the finding*. Nothing anywhere asks when
they stop. The test asserting survival is green, and correctly so.

**This is not a test artefact.** `start_worker()` starts them the same way in
production; these 112 came from e2e runs only because e2e runs are what
happened today.

**A monitor that never dies is the failure it exists to detect**, one level up:
a process that outlives its subject, holds a pid, and reports nothing anybody
reads. The Attaching slice's own no-op monitors are now the largest population
of exactly that on this machine.

#### Where the leak is, and where the fix belongs

**Not in the test.** `makeSandbox().cleanup` is
`fs.rmSync(root, {recursive:true, force:true})` — it deletes the DIRECTORY and
signals nothing. A running process survives the removal of its working
directory, so the monitors slept on. And that is the correct scope for a test
helper: it removes what the test CREATED. The monitors were created by
`plot-dispatch.sh`, and nobody owns ending them.

**The wrapper waits for one child of three.** `plot-dispatch.sh:600`:

```sh
"$PLOT_WORKER_MONITOR" & "$PLOT_AGENT_MONITOR" &
( <cmd> ) & agent=$!
...
wait "$agent"; rc=$?; printf "%s" "$rc" > "$PLOT_EXIT_FILE"
```

`wait "$agent"` is deliberate and must stay — waiting on all three would hang
forever on two infinite loops, and the exit record would never be written. But
after it, the wrapper exits with both monitors still running, and they are
reparented to init.

Reproduced and fixed in isolation, 2026-08-30, on a six-line model of this
wrapper:

```
without cleanup:  survivors 2
with    cleanup:  survivors 0     # kill "$m1" "$m2" after wait
```

**Corrected twice on 2026-08-30, and the second correction withdraws the
first.** An afternoon entry here claimed the leak was the `kill -9` path and
that a `trap` was therefore the load-bearing half. That is wrong: the bound's
SIGKILL goes to the AGENT (`plot-worker-loop.sh:172`), and the wrapper survives
it — it writes `.plot-worker.exit` afterwards, which a killed wrapper could not.

**What killed the monitors of the timed-out run is unexplained.** Its log ends:

```
plot-worker-loop.sh: line 172: 21919 Killed: 9    bash -c '. "$1"' _ "$prompt_file"
plot-worker-loop: prompt exceeded the 3600s bound ...
sh: line 25: 21499 Terminated: 15    "$PLOT_WORKER_MONITOR"
sh: line 25: 21501 Terminated: 15    "$PLOT_AGENT_MONITOR"
```

Three candidate explanations were tested and all three failed: `sh` does not
signal its background jobs at exit (measured directly, and again with
`nohup` + `wait` in the wrapper's exact shape); `plot-dispatch.sh` contains no
`kill`; and neither pid appears in either of the two orphan lists killed by hand
that day. **So this is recorded as unexplained rather than as a third guess** —
a monitor lifetime nobody can account for is exactly the kind of thing this plan
exists to make legible.

#### The proposal that survives it: the registry owns the process group

**Raised 2026-08-30.** The wrapper cannot guarantee anything that outlives its
own death — it is a process. The registry is a **directory**, it outlives every
agent it records, and `DESIGN-agent.md` already assigns it the matching
invariant for desks:

> every agent has a worktree, and no worktree is left behind
> — removed **by the registry, when the agent ends**

*Every agent has its monitors, and no monitor is left behind* is the same
sentence about processes, and it wants the same owner.

**What blocks it today is that the manifest records one pid of three.** Measured
on the running Slice-2 worker:

```
plot-dispatch.sh  (99020)
  └── wrapper     (99021)
        ├── WorkerMonitor       (99044)   ← in no manifest
        ├── AgentMonitor        (99046)   ← in no manifest
        └── plot-worker-loop.sh (99048)   ← "pid": "99048"
```

At that moment: **1 manifest, 76 monitor processes, 0 of them nameable from the
registry.** Nothing that reads the registry can find a monitor, so nothing that
reads the registry can reap one — the reconciliation sweep `plot-worker-loop.sh`
points at for the SIGKILL case included.

**The smallest form that makes it possible** is the manifest carrying the pids
it does not carry today — the wrapper's, and each monitor's beside the agent's.
Then a sweep can ask the one question that decides everything: *this manifest's
agent is gone; are its monitors?* Whether the group is then ended by pid, by
process group, or by the registry refusing to drop a manifest while any of its
pids live is a design question this plan has not answered.

**It is not this slice's, and probably not this plan's.** `two-monitors` is
about what the monitors measure; who owns their lifetime is the registry's
subject, and the registry has its own story. Recorded here because the
measurement that raises it was taken here.

**So the monitors must end where the exit code is written** — the one point
that already runs exactly once, after the agent and before the wrapper goes.
Capture both pids at launch and kill them there. A `trap` on EXIT would be the
other candidate and is weaker here: the wrapper's normal path already reaches
this line, and a trap fires on paths where the exit record was never written,
which is where a monitor is still the most useful thing running.

**This is a lifetime question, and it belongs to the wrapper, so it belongs to
the Attaching slice's code** — added by whichever slice next touches
`start_worker()`, with the assertion the merged slice could not have: after a
worker finishes, **no monitor process remains**. The green `--stop` test asserts
the lower bound (they survive the agent); this is the upper one.

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

**Attaching comes FIRST, and the monitors it attaches start as no-ops.**

An earlier order put it last, on the reasoning that `plot-dispatch.sh` is the
script whose failure stops the whole fleet. That is true and it is why the
protections below are not optional — but it left the first three slices built
and unused: no monitor runs until dispatch starts one, so nothing would have
been observed while the very failures they exist to catch kept happening.
**Three occurred during the writing of this plan.**

**The risk this accepts, stated: a no-op monitor looks exactly like a working
one.** An operator seeing a monitor attached could reasonably assume it is
watching. So the no-op does not stay silent — **it publishes a finding saying it
measures nothing yet**, and that string disappears in the slice that gives it
its first measurement. A monitor that reports its own emptiness cannot be
mistaken for one that has nothing to report.

### Attaching (Branch: feature/every-worker-is-born-monitored, PR: #536)

`start_worker()` starts both monitors inside the wrapper, before the agent.

**Done when**

- a dispatched agent gets both monitors without the operator asking
- **each no-op monitor publishes that it measures nothing yet**, so an attached
  monitor is never mistaken for a watching one
- **there is no code path that creates a worker without them** — asserted by the
  test below, not by review
- killing the agent leaves both monitors alive long enough to record the finding,
  and the wrapper still writes `.plot-worker.exit`
- a hand-made worktree gets neither
- `--dry-run` names which monitors it would attach to which worktree

**`plot-dispatch.sh` is 2028 lines and the largest script here, and
`start_worker()` is where every worker comes into existence — a mistake there
starts no workers at all.** Two protections, and both are needed:

- **This slice goes FIRST and attaches no-ops**, so the change to dispatch is
  the smallest it will ever be: start two processes that publish "nothing
  measured yet". No sampling logic, no host call, no channel semantics — those
  arrive in later slices, behind a dispatch change already proven.
- **`test/e2e/` passes unedited, and `--dry-run` output is byte-identical before
  and after on the same estate.** That is the protection
  `production-calls-the-domain-one-rule-at-a-time` uses for reap and dispatch,
  applied here for the same reason: the dry run exercises every refusal against
  real worktrees and real pids without starting or removing anything.

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

### Ending (Branch: bug/a-monitor-ends-with-its-agent)

**No slice ended a monitor, and the estate shows it.** Every done-when in this
plan asks whether monitors live **long enough**; none asks when they stop. The
Attaching slice's `--stop` assertion is explicitly about survival.

**Measured 2026-08-30, and it is not cosmetic.** With 154 monitor processes
alive, 152 of them `ppid=1`:

```
spawn cost, 100 forks    23.3 ms      ← "tight" by DESIGN-machine.md section 5
after killing the 152    11.6 ms
later, estate quiet       4.8 ms      ← "clear"
```

**The orphans cost half the machine's spawn cost.** Load average did not move
(13.0 before and after), which is exactly why that spec chose spawn cost as the
verdict and calls load average context.

**What is known, and what is not.** The wrapper starts three children and waits
for one (`plot-dispatch.sh:600`); `wait "$agent"` is correct and must stay,
since waiting on two infinite loops would hang and the exit record would never
be written. Beyond that the picture is incomplete: **one timed-out run's
monitors were terminated by something nobody could identify** — three
explanations were tested and all failed (`sh` does not signal background jobs at
exit, measured directly and again with `nohup` + `wait`; `plot-dispatch.sh`
contains no `kill`; neither pid was in either orphan list killed by hand that
day).

**So this slice measures before it fixes.** A cleanup added to a mechanism
nobody understands is how the same processes come back under a different parent.

**Done when**

- **the exit path is established first**, in writing: which process ends the
  monitors today, on the ordinary path and on the `Worker bound` path, with the
  commands that show it. A negative result is a finding.
- after a worker finishes normally, **no monitor of that worker remains** —
  asserted by pid, not by counting
- after a worker is killed at its bound, the same holds
- a monitor still outlives the **agent** long enough to record the finding: the
  Attaching slice's `--stop` assertion stays green, **unedited**
- **the mechanism is a measurement, not a timer.** A monitor that exits after N
  seconds regardless would pass the two assertions above and lose the property
  the plan is built on.

**A second cost, found 2026-08-30 by the repaired reaper.** The monitors write
`.plot-worker.monitor.agent.jsonl` and `.plot-worker.monitor.worker.jsonl` into
the worktree, and **neither is gitignored**. They are present in 10 worktrees,
and the reaper's uncommitted-work refusal reads them as work:

```
keep  feature/the-worker-monitor-samples-the-process  uncommitted: ?? .plot-worker.monitor.agent.jsonl
keep  infra/a-log-lives-under-worktrees               uncommitted: ?? .plot-worker.monitor.agent.jsonl
```

**Two of four refusals in that run are the monitors refusing their own cleanup.**
The refusal itself is correct — uncommitted work is exactly what must stop a
reap — so the defect is that monitor output is not marked as what it is.

**Fix it here, with the lifetime**, since both are about what a monitor leaves
behind: add the two patterns to `.gitignore`. Do it as its own commit —
it changes what `git status` reports in every worktree, and a reviewer should
see that on its own.

**Done when**, additionally: a worktree holding only monitor output reads clean,
and the reaper offers it. Assert against the real filenames rather than a glob
that would also hide an agent's own `.jsonl`.

**Depends on nothing in this plan**, and the earlier slices do not depend on it —
it can run whenever a slot is free. It is filed as `bug` because the behaviour
is already shipped: #536 is merged, and every dispatch since has leaked.

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

### Watching the build (Branch: feature/the-build-monitor-follows-the-run)

The BuildMonitor: four findings about a run, sampled only while one is live.

**Done when**

- `build failed`, `build passed` and `build needs approval` each fire on a real
  run and are individually triggerable against a mocked host
- **`head moved` fires when a newer sha exists**, and a finding about a
  superseded run is never reported as current
- **it polls nothing when no run is live** — asserted, because a monitor that
  keeps asking an idle host is the rate problem this design avoids
- `plot-host.sh` gains the one operation it needs and no more

**`head moved` is the finding that earns this monitor.** A build's subject is a
sha; a green result for code nobody will merge is worse than no result.
Measured this session: two merge waiters reported on superseded runs and had to
be stopped and re-armed.

### The channel (Branch: feature/the-channel-carries-the-findings)

The channel itself: monitors publish, subscribers connect with a purpose.

**Done when**

- a subscriber joining late receives the current findings, not a replay
- **a subscription carries a purpose**: `everything` serves until the subscriber
  disconnects, `until <condition>` serves once and then ends itself
- **a purpose the monitor does not measure is refused immediately**, naming what
  it cannot serve, rather than left pending forever
- **a purpose dies with its subscriber** — no state survives a disconnect
- **two subscribers each receive every finding**, and neither needs to know the
  other exists
- **a monitor that dies stops its heartbeat**, and a subscriber can tell that
  from a monitor with nothing to say

**The last two are what a channel has to earn.** One subscriber is a return
value; two is a channel. And silence-because-healthy versus silence-because-gone
is the distinction the whole design rests on — if a subscriber cannot tell them
apart, the monitor has the same blind spot as the agent it watches.

### Attention (Branch: feature/the-findings-reach-attention)

The findings travel to the board and become attention entries.

**Split from the channel because they are different work with different
proofs.** Measured 2026-08-30: `attention.ts` derives from `AgentRow` — it needs
the findings ON THE ROW, not the channel. The channel is a protocol between
processes; this is a payload field and a render. Proving one says nothing about
the other.

**Done when** an `owes a review` branch appears on the attention surface, the
entry names the branch and what to do, it clears when the PR is opened, and a
WorkerMonitor `idle` finding is distinguishable from an AgentMonitor one in the
entry itself.

### Acting (Branch: feature/a-report-can-open-the-pr)

The master agent opens a PR on `owes a review`, through the controller. Nothing
else acts on anything.

**This slice — and ONLY this slice — waits on
[`the-controller-answers-every-asker`](2026-08-30-the-controller-answers-every-asker.md)**.
It is the entry point the agent acts through, and building a second one here
would be the duplication that plan exists to remove.

**The other four do not wait on anything.** They measure and report; nothing in
them needs a controller. That matters because the controller sits behind a
four-slice plan of its own, and the failures these monitors catch happen daily —
three during the writing of this one. **Holding the whole plan behind the chain
would trade weeks of blindness for one slice's tidiness.**

**A branch that also `owes a gate` still gets its PR, and the body says which
gate is missing.** Opening it anyway is the right call: the work becomes
visible, CI reports the same failure the finding predicted, and the reader knows
why it is red before opening a log. **Withholding the PR would leave finished
work invisible until someone happens to write the changeset** — which is the
failure this plan exists to end, one step later in the process.

**It does not write the missing changeset.** A changeset says what changed and
why it matters; that is a judgement about the work, not a mechanical step, and
an agent guessing at it produces the `<!--` class of entry this repo is already
fixing elsewhere.

**Done when** an `owes a review` finding results in a PR without a person
asking; the PR body names the finding and its evidence, **and any open gate**;
**a second finding for the same branch opens nothing** because a PR now exists;
and the monitors themselves still write and start nothing.

**The idempotence clause is the one that bites.** The finding holds until the PR
appears, and the channel republishes on every interval — an action that fires per
message rather than per state opens a PR a minute until someone notices.

### How all of this is tested

**Unit against mocked ports, plus one end-to-end run per monitor.**

**The sampling logic is testable in isolation and most of it is not about
processes at all.** *Two idle samples with an unchanged tree and commits
present* is a decision over four readings — mock the process port and the host
port and every branch is reachable, including the ones a real machine will not
produce on demand: a host that refuses, a pid that dies mid-sample, a tree that
changes between readings. That is the same technique the domain slices use, and
the reason the sprint's goal says unit AND mock.

**But a mocked monitor proves only its own arithmetic.** The claims that matter
here cross a process boundary — the wrapper outlives the agent, the monitor
reaches the socket from a shell that inherits nothing, a purpose ends with its
subscriber. **Each monitor gets one e2e test** that starts a real wrapper, lets
it publish, and asserts what a subscriber received.

| level | proves | cost |
|---|---|---|
| unit + mocked ports | every finding and refusal, including the unproducible ones | fast, runs per PR |
| one e2e per monitor | the process boundary holds | slow, and the only place it can be checked |

**The e2e tests belong in `test/e2e/`**, beside the dispatch choreography they
extend — a monitor attached by `start_worker()` is part of that choreography,
not a separate subject.

## Notes

**This does not replace reading the board.** It changes what the board can tell
you: today a finished-no-PR branch is indistinguishable from one still being
worked on, and after this it is not.

**The two measured cases are the acceptance test.** If the monitor had been
running, `the-ports-have-adapters` would have reported `finished, no PR` within
one interval of the worker exiting, and `the-domain-agrees-with-production`
would have reported `idle` after two samples — and, once that process was
ended, `owes a review` from the other monitor. Neither needed a person to ask.

### One action, and only one: opening the PR

**The monitors report. The master agent may open a PR on `owes a review`, and
nothing else.**

**That case is the one that actually happened**, three times in a day: finished
work on a branch, tests green, no PR, found only because the operator asked. A
report alone leaves the same gap one step narrower — someone still has to read
it and act.

**Opening a PR is the one action safe to take without judgement**, and the
reason is reversibility rather than convenience:

| act | if wrong |
|---|---|
| **open a PR** | close it — the branch, the worktree and the work are untouched |
| restart an agent | the running one's uncommitted work is at risk |
| reap a worktree | a checkout disappears; re-creatable, but the timing is a judgement |
| kill a worker | whatever it was mid-way through is lost |

**Only the first can be undone by the person who disagrees with it.** The rest
stay with `plot-reap.sh` and `plot-dispatch.sh`, behind the refusals they
already own.

**It needs the controller to ask through**
([`the-controller-answers-every-asker`](2026-08-30-the-controller-answers-every-asker.md)),
so this arrives after that plan lands. **The monitors themselves still act on
nothing** — the action belongs to the agent reading the channel, and keeping the
watcher inert is what lets it run unsupervised.
