# The installed supervisor hands work over

> Both shipped units start `plot-registryd.mjs` with no flags, so the installed supervisor decides every hand-over and performs none. Measured 2026-09-07: `handed=2` for three consecutive ticks while both free agents' manifests carried `branch: ""` and sat quiet for 3,067 seconds.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches

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
