# An unread status is not a sick fleet

> The board gives `plot-fleetctl.sh --status` five seconds and the command takes up to 5.7, so a healthy supervisor is reported as `fleet status unknown` whenever the machine is busy.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches

## Changelog

- The board stops reporting a healthy fleet as unknown. `SUPERVISOR_TIMEOUT_MS` is 5000 ms and `--status` was measured at **1780, 2345 and 5724 ms** on a working machine, so the reading times out under exactly the load a fleet creates — and `unknown` means *the board could not ask*, which an operator reads as *something is wrong with the fleet*.

Board impact: yes, and it is the subject. No wire field changes; the reading gets long enough to complete.

## Design

### What was measured

Three consecutive runs on this estate, with a supervisor up, workers running and panel agents working:

```
--status   5724 ms    ← over the 5000 ms budget
--status   1780 ms
--status   2345 ms
```

`packages/board/src/server/supervisor-reading.ts:50` sets `SUPERVISOR_TIMEOUT_MS = 5_000`, and `:126` wraps the call so that a timeout returns `{ asked: false }`. The rule then answers plainly:

```ts
if (!readings.asked) return 'unknown';
if (!readings.summarised) return 'unknown';
```

**So `unknown` is honest about what it knows** — it means *the board could not ask* — and the sentence it renders, `fleet status unknown`, is what an operator reads as a statement about the fleet.

### Why the command is slow, and why that is not the defect

`--status` starts nothing and is read-only, but it enumerates every agent and asks each desk for its worker state. That is inherent to the question, and it grows with the fleet: on this estate it walks a dozen desks.

**The defect is the budget, not the work.** Five seconds was chosen for a command that answers in under two on an idle machine, and the machine is never idle when the answer matters — a busy fleet is exactly when an operator looks.

### What the fix is, and what it is not

**Raise the budget so it clears a loaded machine.** The measured worst case here is 5724 ms with three panel agents, three workers and a supervisor running. A budget that admits a run of that shape rather than one that just misses it.

**It is NOT retrying.** A retry doubles the cost of the slow case and hides it: the board would report `up` eventually while spending twice the time on every busy pass.

**And it is not making `unknown` quieter.** `unknown` renders as a `note` rather than an `alert`, which is already the right prominence for *I could not read this*. Suppressing a true statement to work around a wrong budget is the shape this estate refuses elsewhere.

### What must not break

**`unknown` must stay reachable.** A board that cannot run the script at all — no `plot-fleetctl.sh`, a broken checkout — must still say so. Raising a timeout must not turn a genuine failure into a hang.

**The timeout must stay bounded.** The board's render path is single-threaded and a 5 s pause already costs one poll; an unbounded wait would make a stuck script freeze the board, which is the failure `plot-boardctl.sh` measures in its own `--stop`.

**`summarised` keeps its own arm.** A run that returned within the budget but printed no summary line is a different failure from a timeout, and both answering `unknown` is correct — what changes is only how often the first one fires.

## Slices

### The status reading outlives a busy machine (Branch: bug/the-status-reading-outlives-a-busy-machine)

- `bug/the-status-reading-outlives-a-busy-machine` — `SUPERVISOR_TIMEOUT_MS` is raised to a measured budget rather than a guessed one, with the three readings above recorded beside it as the reason; a test pins that a run exceeding the budget still answers `unknown` rather than hanging, and that `summarised: false` keeps its own arm

## Notes

- Found by an operator reporting `fleet status unknown` on a board whose supervisor was running (pid 3260, label loaded, `--status` exiting 0). The state was gone by the time it was investigated, which is itself the signature: it tracks machine load rather than fleet health.
- **This is the third distinct defect today behind one symptom.** A supervisor that looked dead was: a leaked test unit holding the label, a test suite unloading it, and now a reading that times out. Each was real and none explained the others.
