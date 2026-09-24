# A supervisor that stopped ticking is not running

> `--status` printed `supervisor: running (pid 3260)` over a daemon whose last log line was 25 hours old. A pid satisfies the check; ticking is what the fleet needs, and nothing asked.

## Status

- **State:** Approved
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-09-24, in-session review after panel (round 1)
- **Started:** 2026-09-24, Jan Wloka (claude session), `bug/the-status-says-when-it-last-ticked`

## Changelog

- `/plot-fleet --status` reports how long ago the supervisor last ticked when it reports it running, so a daemon that holds a pid and stopped working is visible, and the board shows the same reading. Measured 2026-09-23: `--status` said `running (pid 3260)` while `.plot/logs/registryd.log` had not been written for 25 hours and the last tick recorded `cost=2478705ms` — 41 minutes against a normal 13–49 s.

Board impact: **yes**, in the second slice. `supervisor-reading.ts` already spawns `plot-fleetctl.sh --status` every refresh and parses its `summary:` line; carrying the tick age there is what puts the reading on the surface an operator actually visits.

## Motivation

**The fleet's failure mode is silence, and `running` is the word that hides it.** A supervisor that crashes is noticed — the label goes, or the process does. A supervisor that holds its pid and stops ticking looks identical to a healthy one at the only place an operator asks.

### What this plan first claimed, and why it was wrong

The first draft said three free agents timed out because this supervisor had stopped handing out work. **A panel refuted that from the plan's own numbers, and the refutation is kept here rather than quietly deleted.**

The two measurements are mutually inconsistent as a causal story:

- the three agents' `.plot-worker.pid` files are written **2026-09-23 14:10:23–14:10:24**
- the supervisor's log went silent at **2026-09-23 11:01** — three hours *earlier*

A daemon that stopped before the agents existed cannot be what stopped handing *those* agents work.

The log holds the real explanation. **547 ticks read `agents=3 … idle=3` and handed out nothing**, and `no-free-agent=0` on 986 of 987 ticks — so the agents were seen, and were free, and the supervisor had nothing claimable to give them. Every held slice is held `not-claimable`, plus one `no-brief`. Three agents idling for eight hours over an estate with no claimable work is the fleet working correctly.

**The error was this repo's named recurring one** — a small sample written as a property — committed in a plan that cites the rule. Two facts were adjacent and a cause was written between them.

### What remains, and why it is still worth fixing

Strip the causality and a real defect stands: **`--status` reported a supervisor `running` whose last tick was 25 hours old, and nothing anywhere would have said otherwise.** That is a lie about a machine fact, told by the command whose whole job is to report machine facts. The harm it is insurance against has not yet been paid — and the fix is one line reusing a reading that already exists.

## Design

### What was measured

At the moment `--status` reported the supervisor running:

```
supervisor: running (pid 3260) — com.plot-pm.registryd
summary: agents_running=0 agents_other=8 supervisor=up install=running
```

Against the log at that time:

```
registryd.log mtime: Sep 23 11:01:09 2026   (the reading was taken Sep 24 ~12:10 — 25h)
last tick: cost=2478705ms                   (41 minutes)
the eight ticks before it: 13364 49305 28947 48257 18802 48871 19688 ms
```

The final tick completed and printed its full counts, so this was not a crash mid-tick. It finished, and nothing followed. **This half survives the refutation above**: the log still holds `cost=2478705ms` and the seven ticks before it in order, so *the tick completed and nothing followed* is established from the surviving file rather than from the lost mtime.

> The log's mtime has since moved: measuring `bootout` timing for the sibling plan bootstrapped the unit briefly on 2026-09-24. **The 11:01 reading above was taken before that** and is the evidence; the file will not show it again.

### Where the reading is missing, and why it is one branch over

`plot-fleetctl.sh:356` decides `running` from two facts — the label is loaded, and `supervisor_pid` is non-empty:

```sh
elif [ "$sup_loaded" = 0 ] && [ -n "$sup_pid" ]; then
  install_state=running
  echo "supervisor: running (pid $sup_pid) — $LABEL"
```

**The tick age is already read, and already stated as evidence rather than a verdict** — but only in the `LOADED, NOT RUNNING` arm below it (`:374`), which handles *the label is held and no process is behind it*. That arm's own comment has the rule this plan extends:

> THE TICK AGE IS EVIDENCE AND NEVER THE VERDICT. A log's mtime says when the daemon last wrote, and a healthy supervisor between ticks has not written for up to 60 s — so a reader gets the number and this derives nothing from it.

So the mechanism exists, correctly reasoned, one branch away from the case that failed. A supervisor with a live pid never reaches it.

### The shape of the fix

Print the same tick-age line in the `running` arm:

```
supervisor: running (pid 3260) — com.plot-pm.registryd
  last tick: 90061s ago (evidence, not the verdict — a busy tick writes at most every 60s)
```

**It stays evidence and does not become a verdict**, for the reason the existing comment gives: a healthy supervisor between ticks has not written for up to 60 s, and this repo has measured ticks of 49 s. A threshold that called 90 s dead would be wrong about a busy estate, and one generous enough to be safe would not have caught 25 hours any sooner than a person reading the number.

**`summary:` keeps `supervisor=up`.** The state word answers *is a process behind the label*, which was true. Folding liveness into it would make one word answer two questions, which is the defect the three-state split at `:370` was written to remove.

### Why not a heartbeat file

A dedicated heartbeat would be a second record of a fact the log already holds, and the supervisor's design forbids exactly that. `supervisor.ts:49` states it as the one property the design does not have:

> A memo that outlived the tick would make the daemon hold state, which is the one property this design does not have. This is where a world drops it, so `kill -9` still costs one tick and nothing else.

A heartbeat file is that memo, promoted to disk. The log's mtime is free, already read one branch over, and needs no contract.

### What this does NOT do

- **It does not restart anything.** `--status` starts nothing; that property is why it can report an absence at all.
- **It does not judge.** No threshold, no warning word — the number and the same caveat the sibling arm prints.
- **It does not explain the 41-minute tick.** The estate roughly doubled that day (`held=267` → `held=620`), which is a lead and not a finding. A slow tick is a separate subject, and this plan is about the silence being visible.
- **It does not touch the agent bound.** Eight hours of waiting was correct behaviour given no work was offered.

### Open Questions

- [ ] Should `--once` print the previous tick's age too? It runs a tick itself, so the reading is about the daemon rather than the run — likely yes, but it is a second caller and can follow.

### Done when

- `--status` prints the tick age in the `running` arm, with the same evidence-not-verdict caveat as the arm below it.
- **`summary:` still reports `supervisor=up`** for a running supervisor whatever the tick age — the regression this must not cause.
- A missing log file prints no line rather than a zero, the way the existing arm handles it.
- A test drives a running supervisor with a stale log and asserts the line, and one with no log asserting its absence.

## Slices

Two slices, and the second is why the first is worth building. The reading belongs in the shell script; **the surface an operator visits is the board.**

### The status says when it last ticked (Branch: bug/the-status-says-when-it-last-ticked)

- `bug/the-status-says-when-it-last-ticked` — print the tick-age line in `--status`'s running arm, reusing the reading the loaded-not-running arm already makes at `:378`; tests for a stale log, a fresh log and no log; `summary:` unchanged

### The board shows the tick age (Branch: bug/the-board-shows-the-tick-age)

- `bug/the-board-shows-the-tick-age` — carry the tick age from `--status`'s `summary:` line through `supervisor-reading.ts` into the supervisor payload, and render it in the existing banner; the staleness judgement is a **domain** property with unit tests, never a threshold in shell

## Notes

- Found by reading `.plot/logs/registryd.log` after a `--stop` that behaved oddly, rather than by noticing the fleet was idle. Nothing reported the silence; three agents' eight-hour timeouts were the only symptom, and they read as normal.
- The sibling defect found in the same stop is [`a-stop-that-reports-failure-does-not-exit-zero`](2026-09-24-a-stop-that-reports-failure-does-not-exit-zero.md). They are separate: that one is about a write reporting its own result, this one about a reading nobody takes.
- `plot-boardctl.sh --status` is the precedent the `:370` comment already cites, and it applies here in the same partial way: its *two facts must agree* rule belongs to `--stop`, where a wrong guess kills a process. A status prints both readings and lets the reader decide.
