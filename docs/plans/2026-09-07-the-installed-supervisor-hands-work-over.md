# The installed supervisor hands work over

> Both shipped units start `plot-registryd.mjs` with no flags, so the installed supervisor decides every hand-over and performs none. Measured 2026-09-07: `handed=2` for three consecutive ticks while both free agents' manifests carried `branch: ""` and sat quiet for 3,067 seconds.

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-09-07, Jan Wloka, plan-PR #769 merged

## Changelog

- The supervisor installed by `/plot-fleet --start` performs the hand-overs it decides, so a dispatched slice reaches an agent without a person writing a manifest by hand.

<!-- Board impact: none directly. The board renders agents; this changes
     whether they are given work. -->

## Motivation

**Measured 2026-09-07, on this machine.** Two slices were dispatched — `feature/the-board-says-whether-anything-supervises` and `feature/the-ref-deleter-asks-the-rule`, both approved, both briefed, both queued. Three consecutive ticks reported:

```
plot-registryd tick agents=3 left=2 ... handed=2 held=119 idle=0 no-free-agent=0
```

**`handed=2` and `idle=0`** — the supervisor found both slices, matched them to both free agents, and reported the match. **Both manifests still read `branch: ""`**, and both agents had been quiet for 3,067 seconds.

**THE WRITE IS GATED BY A FLAG THE UNITS DO NOT PASS.** `registryd-main.ts:719` is the whole defect:

```ts
if (args.startAgents) await startAgents(report, performer, write, warn);
```

`startAgents` is what walks `report.handOver.writes` and calls `performer.assignSlice` for each `agent-assign` item (`registryd-main.ts:609-611`). Without `--start-agents`, that loop never runs — the decision is computed, counted into `handed=`, and discarded.

**Both shipped units omit the flag.** `units/com.plot-pm.registryd.plist:25` and `units/plot-registryd.service:41` each name `__NODE__ __REGISTRYD__` and nothing else. So this is not one machine's misconfiguration: **every Plot installation that follows `/plot-fleet --start` gets a supervisor that hands nothing over.**

**IT LOOKS EXACTLY LIKE A HEALTHY FLEET.** The daemon is loaded, ticks on schedule, reports agents and a queue, and its summary line says work was handed over. The only visible symptom is agents that stay quiet — which reads as *nothing to do*, and `held=119` appears to confirm it.

**This is the third defect in one chain, and the first two are already fixed.** `the-supervisor-says-why-it-handed-nothing` made the tick say which hold stopped each slice; `a-merged-slice-has-no-ref-to-count` stopped merged slices blocking the queue. Both were needed to see this one: until `handed=` could be trusted to mean *matched*, a `handed=2` that changed nothing was indistinguishable from a queue with nothing in it.

## What this is not

**Not a change to `matchQueue`.** The matching is correct — it found both slices and both agents, and `no-free-agent=0` proves the pool was read right. What is missing is the write.

**Not a new flag.** `--start-agents` exists, is documented at `registryd-main.ts:36`, and works. The question is what the INSTALLED supervisor runs with.

**Not a case for making the write unconditional.** `--once` against a live estate is safe precisely because a tick performs nothing, and `/plot-fleet`'s own gate depends on that: *"a tick decides and performs nothing, so one tick against the live estate is free."* Removing the flag would make the gate a write.

## Slices

### The unit passes the flag (Branch: bug/the-installed-supervisor-hands-work-over)

Both shipped units start the daemon with `--start-agents`, and something proves it.

**BOTH UNITS, NOT ONE.** launchd and systemd are two files that must not disagree — a fleet that assigns on macOS and not on Linux is a defect that only reproduces on half the installations.

**THE FILL IS ALREADY VERIFIED AND THIS RIDES THAT PATH.** `plot-fleetctl.sh` checks for surviving `__PLACEHOLDER__`s and lints the plist before loading. Adding an argument changes what is filled, not how it is verified.

**A TEST MUST READ THE UNIT, NOT THE ARGUMENT PARSER.** `argsFrom` already parses `--start-agents` correctly — that is not where this broke. What went unread for the life of the feature is the **template**, so the assertion belongs there: the file the installer writes names the flag.

**AN INSTALLED UNIT DOES NOT UPDATE ITSELF.** The plist is filled once and baked, the same property that makes the wrong `node` permanent. So this slice must say how an existing installation gets the fix — `/plot-fleet --stop` then `--start` re-fills it — and `/plot-fleet`'s docs should carry that sentence, because an operator whose fleet has this defect will read the skill rather than the plan.

**Done when** both shipped units start the daemon with `--start-agents`, a test asserts each template carries it, a dispatched slice reaches a free agent's manifest without a hand write, and `/plot-fleet` says how an already-installed unit picks the change up.

## Notes

### Why the flag defaults off, and why the unit is the right place to change it — 2026-09-07

The default is right. `--once` is `/plot-fleet`'s gate, and its whole argument is that a tick against the live estate costs nothing because it writes nothing. A daemon that assigned by default would make the gate a write, and the first thing an operator runs while evaluating Plot would change their estate.

**The long-running unit is a different question from the one-shot tick**, and it is the only place where *decide and do nothing* is not what anybody wants. A supervisor exists to supervise; one that watches a queue it will never serve is a monitor with a misleading name.

### What made this invisible for so long — 2026-09-07

Three ticks reported `handed=2`. Every field on that line was true — the slices were queued, the agents were free, the match was made. **The line describes a decision, and nothing on it distinguishes a decision performed from one discarded.**

That is the same shape as the defect `the-supervisor-says-why-it-handed-nothing` fixed six days earlier, at the opposite end: there, `handed=0` gave no way to tell *nothing was ready* from *something is wrong*. Here, `handed=2` gives no way to tell *two agents were given work* from *two agents were not*.

**A count of decisions is not a count of writes, and the summary line should not use one word for both.** Fixing the unit is this plan; whether `handed=` should distinguish them is worth asking after, and is not assumed here.

### The supervisor also does not stay loaded — 2026-09-07, unexplained

**Three times in one session** the launchd job vanished: `launchctl list` reported nothing, `launchctl print` answered *"Could not find service in domain for user gui: 501"*, and each time `launchctl bootstrap` brought it straight back and it ran normally.

**Every measurement rules out a crash.** `runs = 1` and `last exit code = (never exited)` on a job that had ticked for minutes; `registryd.err` is **0 bytes** across every incarnation; `KeepAlive` is `true`, `ThrottleInterval` 60, and the job is not in launchd's disabled set. A crashing daemon under `KeepAlive` would restart and raise `runs`, and it never did. **It is being booted out, not dying.**

**Nothing in Plot boots it out.** `launchctl bootout` appears once in the codebase, at `plot-fleetctl.sh:480`, reached only by `--stop`, which was not run. `plot-worker-loop.sh` and `plot-dispatch.sh` name it zero times.

**The one correlation.** The last tick before the third disappearance reported `started=2` — the tick that spawned two agents. The agents survived it and are parented to `sh` (51457, 51587), so they are detached rather than children of the daemon. Whether starting agents is the trigger or a coincidence of timing is **not established**, and this note deliberately stops there.

**FOUR HYPOTHESES TESTED, ALL FOUR DISPROVED — 2026-09-07.**

**Memory pressure / jetsam.** Ruled out by measurement: 52% system-wide memory free, and `log show` for `jetsam` and `memorystatus` over the window returns **nothing**.

**`AbandonProcessGroup`.** The plist does not set it, so it defaults false, and the daemon's agents are started with `nohup ... &` and no `setsid` — `plot-dispatch.sh:687` says why: *"`setsid` is not used — it does not exist on macOS."* A child in the job's process group exiting looked like it could take the job with it. **Tested with a control unit**: same `ProcessType`, `KeepAlive` and no `AbandonProcessGroup`, spawning a `nohup sleep 8 &` and then logging every 2 s. It logged **8 lines past its child's exit and stayed loaded.** The mechanism does not fire.

**`/plot-fleet --once`.** It is `exec node "$registryd" --once` (`plot-fleetctl.sh:256`) — a plain process that never calls `launchctl`. `bootout` appears once in the whole codebase, at `:480`, reached only by `--stop`.

**`/plot-fleet --start` racing a loaded job.** It refuses on a label already loaded (`:297`) before writing anything, so it cannot have rewritten the plist under a running daemon.

**What that leaves is unexplained.** The job is booted out by something outside Plot, leaving no trace in launchd's log, in `registryd.err`, or in its own exit code. The next step is a watcher that catches the transition rather than finding it afterwards — running as of this note.

**CAUGHT IN THE ACT — 2026-09-07, and the answer is machine load.** A watcher sampling every 15 s recorded the transition:

```
11:37:58 up pid=43333 etime=17:22
11:38:13 *** GONE ***
11:38:13 err bytes: 0
11:38:13 load: 43.68 25.28 20.26
```

**Load average 43.68 on a machine whose fleet normally sits near 10.** The daemon is `ProcessType: Background`, which is exactly the class macOS deprioritises and evicts first, and every earlier reading fits: no crash, no stderr, `runs = 1`, `never exited` — a job removed by the system, not by itself.

**What produced the load was measured rather than guessed.** At the moment of death: **22 concurrent `plot-fleet-scan` processes** and **10 `node --test` runs**. Two distinct sources:

- **Orphaned scans.** Twelve carried `ppid 1` — reparented to launchd, their worker long gone, still running. Four ignored `SIGTERM` and needed `SIGKILL`. They belonged to `free-2725507d`, a worktree with **no live worker and no manifest**.
- **Legitimate agent work.** Five dispatched slices each running the repo gates; `pnpm test` alone is several `node --test` processes.

**The scan is 18.3 s against the board's 5 s pulse**, so a stream that outlives its consumer stacks — and nothing reaps one whose parent died.

**A FIFTH EVICTION REFINED IT, AND FOUND A SEPARATE LEAK.** The fifth happened at load 36.71 with **zero orphaned scans** — so the scans were a contributor, not the cause. The load alone evicts it.

What was burning the machine that time was a **leaked test fixture**. `test/reconcile/workerstate.test.mjs:652` spawns `sh -c 'sh -c "while :; do :; done"'` — its own comment says *"a shell with a BUSY grandchild"* — and its cleanup called `busy.kill()`, which signals the **child**. The grandchild survived every run, orphaned to `ppid 1`.

**One escapee had been spinning a full core for 22 hours 58 minutes.** Killing it alone took the load average from 36.7 to 24.4. Fixed by spawning `detached` and signalling the process group; the test now passes and leaks nothing, measured 0 before and 0 after.

**THIS DOES NOT EXCUSE THE DAEMON.** A supervisor that is evicted under exactly the load a working fleet produces is a supervisor that leaves when it is most needed. But the trigger is now named, and the two follow-ups are separable: an orphaned-scan reaper, and whether `ProcessType: Background` is the right class for a job that must outlive a busy fleet.

**Why it is recorded here rather than fixed.** This plan is about a supervisor that hands nothing over. A supervisor that hands work over and then disappears is a second defect, and it needs a measurement this session did not get: what the system log says at the moment of the bootout. `log show --predicate 'process == "launchd"'` returned nothing for the window, which is itself a finding — the eviction leaves no trace either.

**What it costs, meanwhile.** The fleet stops being supervised and nothing says so — which is exactly what [`the-board-says-whether-anything-supervises`](2026-09-07-the-board-says-whether-anything-supervises.md) makes visible. That plan was written from the FIRST occurrence of this, before it was known to recur. **It is now the more urgent of the two**: an operator cannot act on a supervisor that leaves without a word until the board tells them it left.
