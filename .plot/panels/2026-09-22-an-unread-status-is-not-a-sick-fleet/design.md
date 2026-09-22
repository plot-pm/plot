# Design lens — an unread status is not a sick fleet

Position: amend

## The short form

The symptom is real and the direction of the fix is right — `unknown` on a healthy
fleet is a false alarm and the budget is too small. But the plan's central design
claim is false as written, and I measured it false.

**The plan says the cost is "inherent to the question". It is not.** The supervisor
verdict is decided before the expensive part of `--status` runs, and the expensive
part is a duplicate of work the same refresh already did forty lines earlier. A
raised number buys back a defect that a one-line flag removes outright.

## 1. Is the budget the defect, or is the cost the defect?

**Both, and the cost is the one the plan got wrong.**

`plot-fleetctl.sh --status` does two separable things:

| lines | work | cost |
|---|---|---|
| 341–401 | `platform`, `supervisor_loaded`, `supervisor_pid`, `fleet_install_state` | 75 ms measured (one `launchctl print`) |
| 440–470 | walk every desk, `plot_worker_state` per desk, `stat` the log per desk | the rest |

`install_state` — the ONE field the board's rule consumes beyond the exit code — is
fully assigned at `:341`, `:357`, `:370` or `:401`. **Every one of those is above the
desk loop.** The `summary:` line at `:474` and the exit code at `:486` both read that
already-captured variable; the script's own comment says so (*"THE EXIT CODE COMES
FROM THE CAPTURE, NEVER FROM A FRESH PROBE"*). The desk walk contributes
`agents_running=` and `agents_other=` to the summary line and nothing else.

**And the board does not use those two fields.** `readSupervisor`
(`supervisor-reading.ts:126`) keeps exactly four things: `asked`, `exitCode`,
`summarised` (a substring test for `summary:`), and `install` (scanned for
`install=`). `supervisorState` reads `asked`, `summarised`, `exitCode`, `install`.
The agent count the verdict needs comes from `liveAgents` on the render clock, not
from this script — `fleet.ts:7630` and the field's own docstring say so explicitly.

So the board pays for a desk walk whose entire output it discards.

**Worse: it pays for it twice in the same refresh.** `fleet.ts:3155` awaits
`readAgentRegistryWithInfo`, which runs `bashLiveness` — one bash process sourcing
`plot-worker-state.sh` over every worktree (`registry.ts:864`). Ten lines later,
`fleet.ts:3166` awaits `readSupervisor`, which runs `--status`, which loops the same
worktrees calling the same `plot_worker_state` (`plot-fleetctl.sh:445`). Same helper,
same population, same refresh, back to back.

**Measured here, now:** 19 desks under the configured worktree root, `--status` at
2006 / 888 / 919 ms. One `launchctl print` in isolation: 75 ms. One
`plot_worker_state` on one desk: 36 ms. 19 × 36 ≈ 684 ms — which is the whole
variable part of the reading, and all of it is thrown away.

So the honest answer to *is any of that work avoidable, cacheable, or already
answered elsewhere on the board?* is **yes on all three counts**, and the plan
asserts the opposite without checking.

## 2. Does a raised number stay right?

**No.** The desk walk is O(desks) and the fleet is the thing that grows. The plan
picks a budget from a worst case of 5724 ms at "three panel agents, three workers and
a supervisor" — a sample of one, of one shape, on one machine, on one day.

The repository already contains a higher measurement than the plan's, and the plan
does not cite it. `plot-fleetctl.sh:337`, written this same month, reads:

> the board's whole reading is bounded at 5,000 ms against a measured 4726–9770 ms
> with three agents

**9770 ms.** A budget chosen to "admit a run of that shape" from a 5724 ms sample is
already below a number recorded in the file the plan is fixing. That is the argument
against a raised number making itself, in the codebase, unread.

**What the fix would have to be for the answer to be no:** make the reading's cost
independent of the fleet's size. Two shapes do that, and the first is nearly free:

- **Ask only what is consumed.** A `--status --supervisor-only` (or an early exit
  before the desk loop when a flag is set) returns the same four facts the board
  reads, at the 75 ms `launchctl` cost, flat in the number of desks. The `summary:`
  line, the `install=` field and the 0/1 exit code all stay byte-identical, so
  `readSupervisor`, `supervisorState`, and every test on them are untouched. This is
  a *narrowing*, not a new source — it does not violate the "one source" rule the
  module is organised around, because it is the same script answering the same
  question with the half nobody reads removed.
- **Or: let the registry read serve both.** The refresh already holds per-desk
  liveness from `bashLiveness`. That is the harder change and it crosses a
  contract boundary; I would not do it in this slice.

With the first, the budget question dissolves — 5000 ms against 75 ms is 66× rather
than 0.87×, and it stays 66× when the fleet doubles.

## 3. Is the render path single-threaded and blocked by this?

**No, and the plan's "what must not break" paragraph is wrong about the mechanism.**

`readSupervisor` is awaited inside `refresh` (`fleet.ts:3166`). `refresh` is started
with `void refresh(opts, entry)` from `ensureCache` (`fleet.ts:3539`) and from the
pulse tick — never awaited by a request handler. `refresh` opens with
`if (entry.running) return;`, so a slow refresh does not queue; it makes the *next*
tick a no-op. `/api/board` reads `entry.pulse` and `entry.supervisor` as they stand.

So a 5 s pause costs **staleness of one refresh cycle**, not a blocked render, and an
unbounded wait would not "freeze the board" — it would pin `entry.running` true and
leave the board serving its last complete pulse indefinitely, with the supervisor
field frozen at its last value. That is bad, and it is a different bad: silent
staleness rather than a freeze.

The conclusion (*keep it bounded*) is right. The stated reason is not, and the plan
offers that reason as a constraint on the fix. A slice written from it could pick a
budget to protect a render path that is not there.

The real bound to respect is the cadence relationship: `REFRESH_MS` is 5 s, so a
reading that regularly costs ~5 s consumes a whole tick. Raising the budget past the
cadence means a busy machine's refresh is dominated by a reading whose expensive half
is discarded. **That is the argument the plan needed and does not make**, and it
points at narrowing the reading rather than widening the budget.

## 4. A shape the plan did not consider

It considers two alternatives and rejects both. It does not consider the one the
estate's own rules point at.

**Narrowing the reading beats every option the plan weighs**, and it is the only one
that needs no new state. Judged against this repo's rules:

- *Layering:* `readSupervisor` is an adapter-side reading handed to a pure rule as a
  value. Narrowing changes which flag the adapter passes. The port, the rule, the
  verdict and the wire field are all untouched. Nothing moves across a boundary.
- *Every rendered state is a domain property:* `supervisorState` and
  `supervisorProminence` stay exactly as they are, with their existing unit tests.
  No view state moves into a component.

Now the three the panel brief named, for completeness:

- **Async with an age** — render the previous answer stamped with how old it is. This
  is a real pattern here (`prNote` keeps an age suffix; the pulse bridge serves a
  stale document labelled with its real age). But it adds a `supervisorAt` field, a
  staleness rule, and a rendering decision, to work around a cost that should not
  exist. It is the right answer *if* the reading is irreducibly slow. It is not.
- **Splitting the reading so the cheap half always answers** — this is the same fix
  as narrowing, arrived at from the other side, and it is the recommendation.
- **Caching** — refuse. The plan's own module header refuses a second implementation
  drifting toward *looks fine*; a cached supervisor state is that drift with a
  timestamp. It would also collide with `died`, whose whole point is that the
  supervisor went away between readings.

## 5. Does `unknown` staying reachable survive?

**Partly, and the plan's framing hides a live hazard it did not test for.**

Trace it. `runProcess` (`run-script.ts:59`) uses `execFile` with `timeout`, and
resolves rather than rejecting: on a `SIGTERM` timeout it returns
`{ code: 1, stdout: <partial>, stderr }`. So `readSupervisor` does **not** hit its
`catch` — it returns `asked: true, exitCode: 1, summarised: false`. `summarised:
false` is what carries the timeout into `unknown` at `supervisor-reading.ts:238`.
That arm is reached before the exit code is consulted, and it is tested
(`supervisor-reading.test.ts:59`). So yes: `unknown` survives a timeout, and the
plan's must-not-break holds *for the timeout path*.

**But the plan's state list is stale, and that is the hazard.** It quotes the rule as
two lines answering `unknown`, and there are now four states: `#950` added `died`,
reached when `exitCode === 1` and `install` is `installed` or `loaded-not-running`
(`supervisor-reading.ts:241`). A timeout returns exit 1 with partial stdout. Whether
that partial stdout contains an `install=` field decides `died` versus `unknown` —
and it survives today only because `installState` scans the `summary:` line, which is
the same line `summarised` tests for, so the two cannot disagree.

That is a coupling the plan neither names nor pins. Its slice says a test should pin
that a run exceeding the budget answers `unknown` — good — but it must also pin that
such a run does **not** answer `died`, because `died` renders `alert` when agents are
running (`supervisorProminence:272`) and is the loudest thing this module can say. A
timeout rendering `died` would turn the false `note` this plan removes into a false
alarm, which is strictly worse than the defect.

The `summarised` arm is also load-bearing in a way the plan lists as a separate
concern — "`summarised` keeps its own arm" — when it is in fact the *only* thing
standing between a timeout and the `died` arm. It is one mechanism, not two.

## What I would amend

1. **Replace the premise.** Strike *"That is inherent to the question"*. The
   supervisor verdict is decided at `plot-fleetctl.sh:341–401`, before the desk loop
   at `:440`, and the board discards `agents_running=`/`agents_other=`. Record the
   measurement: 19 desks, 2006/888/919 ms, one `launchctl print` at 75 ms, one
   `plot_worker_state` at 36 ms, and the duplicate walk against
   `registry.ts:864`'s `bashLiveness` ten lines earlier in the same refresh.
2. **Change the slice.** Narrow the reading — a flag that returns the same four
   consumed facts without the desk walk — rather than raising `SUPERVISOR_TIMEOUT_MS`.
   Same script, same summary line, same `install=` field, same 0/1 exit code, same
   rule, same tests. If a budget change is still wanted afterwards it is a trivial
   second commit against a cost that no longer grows.
3. **Cite the higher measurement.** `plot-fleetctl.sh:337` already records
   4726–9770 ms with three agents. A plan raising the budget from a 5724 ms sample
   must address the 9770 ms already written into the file it edits, or explain why it
   is discarded.
4. **Fix the render-path paragraph.** `refresh` is `void`-started and guarded by
   `entry.running`; it does not block a render. State the real bound — the 5 s
   `REFRESH_MS` cadence — which argues for narrowing, not widening.
5. **Add the `died` guard to the slice's test list.** Pin that a timed-out run
   answers `unknown` and **not** `died`, and say in the test why: `installState`
   reads the same `summary:` line `summarised` tests for, so partial stdout cannot
   produce an `install=` without a `summarised: true`.

Nothing here disputes the defect. A healthy fleet reported `unknown` is worth fixing
today. I dispute that the fix is a bigger number, on a cost this estate measured,
duplicated, and then described as inherent.
