# A stop that reports failure does not exit zero

> `/plot-fleet --stop` printed *"supervisor did NOT unload"* and exited 0. The supervisor had in fact unloaded; the check ran before launchd finished, and because the run was recorded as failed the start marker stayed, which made the next `--status` report a crash that never happened.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches

## Changelog

- `/plot-fleet --stop` verifies the unload rather than asking once, and exits non-zero when it cannot confirm one. Measured 2026-09-24: a stop of a supervisor whose last tick had run 41 minutes printed `supervisor did NOT unload` and exited 0, while `launchctl print` moments later reported the job gone. A caller reading the exit code recorded that run as a clean stop, and the marker it left behind made the next `--status` announce a crash.

Board impact: none. `plot-fleetctl.sh` is fleet control's own mechanics; no plan field, template or board payload changes.

## Motivation

**A stop is the one fleet action whose result a caller cannot re-derive.** A dispatch can be re-read from the refs, a tick recomputes from scratch, but whether the supervisor is down is a machine fact that decays — and the exit code is what an automated caller has.

Here the exit code and the printed text disagreed, and **the text was right about the check and wrong about the world**:

```
no agents on a branch; stopping the supervisor
  supervisor did NOT unload — com.plot-pm.registryd is still loaded
exit=0
```

Both halves are defects, and they compound. The stop reported a failure it did not have, then exited as though nothing had gone wrong.

## Design

### What was measured, 2026-09-24

The supervisor **was** unloaded by that call. Immediately after:

```
launchctl print gui/501/com.plot-pm.registryd   -> exit 113 (not loaded)
launchctl list | grep com.plot-pm.registryd     -> 0 matches
kill -0 3260                                    -> gone
pgrep -fl plot-registryd                        -> nothing
```

So `supervisor_loaded` at `plot-fleetctl.sh:763` answered true in the window between `launchctl bootout` returning and launchd finishing the teardown.

### The window is not a constant, and that decides the fix

An idle unit tears down almost at once. Measured by bootstrapping the real unit and polling every 50 ms after `bootout`:

```
bootout returned 0
 -> gone after ~50ms (iteration 1)
```

**That measurement did NOT reproduce the failure, and stating so is the point.** A fixed sleep sized from it would be sized from the case that already works.

What differed at the failure: `KeepAlive` is `true` and unconditional, so `bootout` must end the process *and* tear down the restart contract; and the supervisor being stopped had a last tick of `cost=2478705ms` — 41 minutes — with no log line for 25 hours. `bootout` waits for the process to leave, and a process wedged mid-tick does not leave promptly.

**So the delay scales with how stuck the job is, and has no bound this script can know.** That rules out a sleep and calls for a bounded retry that says what it observed.

### The shape of the fix

Poll `supervisor_loaded` to a bound instead of asking once:

- ask immediately, then at a short interval, up to `--wait` (the flag the stop already takes for agents)
- **gone within the bound** — print `supervisor unloaded`, clear the marker, exit 0
- **still loaded at the bound** — print that it is still loaded, name the bound, **keep the marker, and exit non-zero**

The second arm is the one that is missing today in both halves: the run neither reports failure through its exit code nor leaves a state a later reader can interpret correctly.

### Why the marker must follow the observation, not the attempt

`.plot/state/fleet-start.done` records that a `--start` finished. `--stop` clears it **only after a confirmed unload**, which is correct and stays. The bug is upstream: a false negative on the unload left a marker describing a run that had ended.

`--status` then reasons from the marker's presence to a cause:

```
supervisor: STOPPED — a --start finished here and the supervisor is gone since
  Nothing unloaded it: --stop clears this marker only after a clean unload.
  So it died on its own — a crash, a logout, or an OS update.
```

**That inference is sound and its premise was false.** The prose is not what needs changing — fixing the observation fixes the message.

### What this does NOT do

- **It does not make `--stop` force anything.** A supervisor that will not unload within the bound is reported, not escalated to `kill -9`. Ending a wedged process is a person's call, and the refusal names what to look at.
- **It does not touch the agent loop.** Agents are stopped before the supervisor and that order stays.
- **It does not change `--status`'s prose.** Its reasoning is correct; it was fed a wrong fact.
- **It does not diagnose why a tick took 41 minutes.** That is [`a-supervisor-that-stopped-ticking-is-not-running`](2026-09-24-a-supervisor-that-stopped-ticking-is-not-running.md)'s subject.

### Done when

- `--stop` polls the unload to the `--wait` bound rather than asking once, and a confirmed unload still clears the marker.
- **An unconfirmed unload exits non-zero and keeps the marker.** A test drives both arms.
- A stop of an unloaded supervisor still reports `supervisor was not loaded` and exits 0 — the regression this must not cause.
- The contract suite covers the exit code, because the exit code is what a caller gates on and prose is not.

## Slices

### The unload is verified to a bound (Branch: bug/the-unload-is-verified-to-a-bound)

- `bug/the-unload-is-verified-to-a-bound` — poll `supervisor_loaded` after `bootout` up to the `--wait` bound; exit non-zero and keep the marker when the bound is reached; tests for the confirmed arm, the unconfirmed arm and the not-loaded arm

## Notes

- Found by running `/plot-fleet --stop` and reading the exit code against the printed text rather than accepting either. The two disagreed, and `launchctl` settled it.
- `plot-boardctl.sh` already holds the pattern this adopts: it proves the board answers rather than reading an exit code, because *"the server reports a busy port and exits 0, so the exit code answers a different question"*. The same sentence applies here with `bootout` in place of the port.
