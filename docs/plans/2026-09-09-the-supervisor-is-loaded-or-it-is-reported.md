# The supervisor is loaded, or it is reported

> A unit file on disk that launchd was never told about looks exactly like a healthy install to anyone who checks for the file, and exactly like no install at all to `--status`. The supervisor was down for hours on 2026-09-09 and nothing said so.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** pr
- **Impl:** own branches

## Changelog

- `/plot-fleet --start` cannot leave a written-but-unloaded unit behind, and `--status` names that state when it finds one. A stopped fleet is announced prominently on the board — in a person's words, naming what will not happen and how to fix it — rather than discovered hours later in a chip reading `supervisor unknown`.

Board impact: yes. `supervisor unknown` is one of the states this plan gives a reason.

## Motivation

**Measured 2026-09-09: the supervisor was not running for several hours, and nothing reported it.**

`launchctl list` showed no `com.plot-pm.registryd`, while
`~/Library/LaunchAgents/com.plot-pm.registryd.plist` sat on disk, correct and
5344 bytes. One command restored it:

```
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.plot-pm.registryd.plist
→ 81406  0  com.plot-pm.registryd
```

### It did not crash, and the unit is not at fault

**`KeepAlive` is unconditional and the unit says why:**

> KEEPALIVE IS THE WHOLE POINT, and it is unconditional. The daemon exits only
> when killed or when the machine stops it; every recoverable failure is now a
> tick that reports and continues, so an exit means the process itself is gone
> and restarting it is always right.

launchd honours that. A crashed supervisor comes back in 60 s (`ThrottleInterval`). **A supervisor launchd was never told about does not**, and that is the state this estate reached.

### The cause is a non-atomic `--start`

`plot-fleetctl.sh --start` fills the unit, verifies it (`plutil -lint`),
bootstraps it at `:361`, and then starts agents at `:382` by calling
`plot-dispatch.sh --start`. **Cutting agent desks is the slow part** — each is a
`git worktree add` — and a run interrupted during it leaves the machine in a
state with no name: a unit file present, launchd unaware, agents partially
started.

Measured twice in one session. Both `--start` invocations were killed while
cutting desks, and each left the plist behind.

**The order is right and the atomicity is missing.** Bootstrapping before the
agents is correct — a supervisor with no agents does nothing, but agents with no
supervisor are worse, and `--stop` unloads the supervisor LAST for the same
reason. What is absent is any record that the run did not finish.

### `--status` cannot tell the two failures apart

Both print the same line:

```
supervisor: not loaded (com.plot-pm.registryd)
```

| what is true | what it needs |
|---|---|
| no unit file exists | `--start` — fill, verify, bootstrap |
| a unit file exists, unloaded | **one `launchctl bootstrap`** |

The second is a thirty-second repair that reads as the first, which is a
multi-minute one that re-cuts desks. An operator who reads *not loaded* and runs
`--start` pays for the wrong repair — and on a machine already running agents,
`--start` may add more.

### Nothing watches, so nothing alerted

The board renders `supervisor unknown` and stops there. No tick reported the
absence, because the thing that reports ticks is the supervisor. **The observer
and the observed are the same process**, which is why a down supervisor is
silent by construction and why the alert has to come from somewhere else.

## Design

### `--start` records that it finished

A run writes its completion the way the lifecycle scripts write receipts:
machine-local under `.plot/state/`, naming the label and the moment bootstrap
succeeded. An interrupted run leaves the marker absent, and **absent is the
signal** — no timer, no heuristic, and no need to distinguish a kill from a
crash.

**Not a lock file.** A lock says *a run is in progress*, and answers wrongly for
a run that died: the question is not *is something running* but *did the last
run finish*. `plot-estate-changed.sh` makes the same distinction — *"a clock
would answer 'was it recent?' when the question is 'did it change?'"*.

### `--status` names the three states

```
supervisor: running (pid 81406) — com.plot-pm.registryd
supervisor: NOT LOADED — a unit file exists and launchd was never told
              repair: launchctl bootstrap gui/$(id -u) <path>
supervisor: not installed — no unit file
              repair: /plot-fleet --start
```

**The repair is printed because the two are indistinguishable to a reader and
different in cost.** This is `plot-fleetctl.sh`'s existing habit — each of its
four refusals already names its own repair — extended to the state it currently
collapses.

### Self-healing, and its bound

`--status` **reports**; it does not bootstrap. But an unloaded unit whose
completion marker is present is an interrupted install with an unambiguous
repair, and `--start` on that machine should finish the job rather than re-cut
desks that already exist.

**The bound is that `--start` never bootstraps a unit it did not verify this
run.** A plist of unknown provenance is exactly what `plutil -lint` and the
`__PLACEHOLDER__` check exist to refuse, and *"an installed unit does not update
itself"* — a stale unit baked with the wrong `$NODE` fails long after anyone is
watching.

### The board says FLEET STOPPED, not `supervisor unknown`

**"Supervisor" is implementation vocabulary and it has leaked into the UI.**
`supervisorVerdict` renders `supervised` and `supervisor unknown`; a person
reading the board does not have a supervisor, they have a **fleet**, and what
they need to know is whether it is running. The launchd label, the daemon and
the word *supervisor* are all correct in `plot-fleetctl.sh` and in
`DESIGN-process.md` — they are machine-side vocabulary, and the board is the one
surface where a person reads instead of a machine.

| today | what a person needs |
|---|---|
| `supervised` | **Fleet running** |
| `supervisor unknown` | **Fleet status unknown** — I could not ask |
| *(no state)* | **FLEET STOPPED** — nothing is picking up work |

**The estate already draws this line and this is the same one.** `CLAUDE.md`
splits Machine-side vocabulary (`worker`, the six process states) from
Registry-side (`agent`), by *"the component doing the observing"*. A reader of
the board is neither; the badge is the one place the internal word must not
appear.

### Fleet stopped is an ALERT, not a badge

**The current rendering is a status chip, and a stopped fleet is not a status —
it is work not happening.** Measured 2026-09-09: three agents idle 44–57 minutes
with merged PRs, an eligible slice nobody took, and a board whose only signal
was the word `unknown` in a chip. Every one of those facts was rendered
correctly and none of them said *nothing will move until somebody acts*.

The badge already carries a `prominence` field, so the mechanism exists. What
this slice adds is the **state that earns the top of it**:

- **Prominent, not a chip.** A stopped fleet belongs where `WAITING ON YOU`
  already draws the eye — the section a person reads first — rather than beside
  the agent count they read last.
- **It names the consequence, not the condition.** *"Fleet stopped — no slice
  will be picked up"* says what a reader must decide about. *"supervisor
  unknown"* names a component and leaves the consequence to be derived.
- **It carries the repair**, the same way `plot-fleetctl.sh`'s four refusals do:
  `/plot-fleet --start`, or the one-line bootstrap where a unit is merely
  unloaded.
- **It is not dismissible.** A stopped fleet that scrolls away is the outage
  this plan was written from.

**`unknown` stays quiet, and that asymmetry is deliberate.** *I could not ask*
is a reading about the board, not about the fleet, and alerting on it would
train an operator to dismiss the alert that matters. Only *asked, and it is not
there* is loud.

### The alert is the board's, because the supervisor cannot report its own absence

`supervisor unknown` is rendered today and means *I could not ask*. That is
honest and insufficient: the board knows the label, can ask launchd, and can
tell *not loaded* from *cannot tell*.

**It reports and does not act.** Starting a supervisor from a rendering path
would make a page load a lifecycle action, which is the boundary
`DESIGN-process.md` draws — fleet control and the board are independent systems
sharing a machine, and neither may become a dependency of the other.

### Not chosen: a watchdog process

A second process watching the first has the same failure mode one level up, and
the machine already has one supervisor-of-last-resort — launchd, with
`KeepAlive` — which works correctly whenever it has been told. **The defect is
never telling it**, and adding a process does not fix an install that did not
complete.

### Not chosen: bootstrapping from `--status`

It is tempting and it breaks the read-only contract every status command in this
estate keeps: *"It starts nothing — a status that started what it was asked
about could never report an absence."*

### Open Questions

- [ ] **Should the board's check be a tick or a page load?** Asking launchd per
      request is cheap but repeats; a periodic check needs somewhere to live,
      and the only always-on process is the one being checked.
- [ ] **What does `systemd` need?** The linux arm calls `systemctl --user enable
      --now`, which is enable-and-start in one — so a partial install may be
      impossible there, or may fail differently. Measured on macOS only.

## Slices

### Finishing

- `bug/a-fleet-start-records-that-it-finished` <!-- builds: the start-completion marker and the three-state status --> — `--start` writes a completion marker after bootstrap verifies, and `--status` distinguishes *not installed*, *not loaded*, and *running*, printing the repair for each.

  **Asserted: a `--start` interrupted during agent creation leaves no completion marker**, which is the measured failure reproduced. **Asserted: `--status` says NOT LOADED and prints the one-line bootstrap** when a unit file exists and launchd does not know it — the state that read as *not installed* for hours. **Asserted: `--status` still starts nothing**, in all three states. **Asserted: `--start` on an unloaded, verified unit bootstraps rather than re-cutting desks**, and refuses a unit it did not fill this run.

### Reporting

- `bug/the-board-says-the-fleet-is-stopped` <!-- builds: the fleet-stopped reading and its prominent alert, distinct from cannot-ask --> — the board asks launchd for the label, and where it renders `supervisor unknown` today it renders **FLEET STOPPED** prominently, naming the consequence and the repair. Waits on `bug/a-fleet-start-records-that-it-finished`, which defines the states.

  **Asserted: the word `supervisor` does not appear in the rendered UI** — it is machine-side vocabulary, correct in `plot-fleetctl.sh` and wrong on the one surface a person reads. **Asserted: `unknown` and `stopped` are different words** — one means *I could not ask*, the other *I asked and it is not there*, and collapsing them is what made this outage silent. **Asserted: only `stopped` is prominent** — `unknown` stays a quiet chip, or an operator learns to dismiss the alert that matters. **Asserted: the alert names the consequence and the repair**, not the component. **Asserted: the board starts nothing** — it reports, and acting stays the operator's, since a page load must never become a lifecycle action.

## Notes

Written 2026-09-09, after the supervisor was found down twice in one session by
a person noticing the board, not by anything reporting it.

**The unit is correct and this plan changes nothing about it.** `KeepAlive`
already does its job; every finding here is about the window before launchd is
told, and about a status line that cannot describe that window.

Definition of Done: docs/definition-of-done.md
