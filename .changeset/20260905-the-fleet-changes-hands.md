---
'plot': minor
---

`/plot-fleet` becomes `/plot-pulse`, and `/plot-fleet` returns as fleet control
in the same commit. The read-only report keeps every behaviour — the same scan,
the same advice, the same pulse line — and takes the word it had always printed:
the skill said *pulse* 26 times, its step 5 is *Append a Pulse Line*, and the
scan ends with `Pulse complete.`

**No alias.** The name is reused rather than retired, so a `/plot-fleet`
answering a pulse would give the old behaviour to somebody asking for the new
one. Both meanings change in one commit for the same reason: split in two, the
rename lands first and `/plot-fleet` does not exist until the second branch
merges.

`plot-fleet-scan.sh` does not move — the scan reads the fleet and that name
stays right, which is why the rename is 21 live references and not the 284 files
a naive grep reports. The 97 files of historical prose under `docs/` are left
alone; they record what was true when written.

The new `/plot-fleet` is the door `plot-registryd` shipped without: `--once`,
`--status`, `--start [N]`, `--stop`, backed by `plot-fleetctl.sh`. It probes
before it acts and refuses rather than repairs, on four measurements — a missing
artifact, a `node` that is not `.nvmrc`'s major, no launchd or systemd, and a
label already loaded. The node refusal fired on the operator's own machine while
this was written: 26.7.0 against a repo pinned to 24, and the unit bakes that
path in permanently.

`--stop` is an orchestration, not a second stop rule. It calls
`plot-dispatch.sh --stop <branch>` once per dispatched agent, reports each
branch as it goes, bounds each wait at 30 seconds and names what did not exit,
and unloads the supervisor LAST — it is what would notice a desk falling idle.

<!--
bumps:
  skills:
    plot-fleet: major
    plot-pulse: minor
    plot-dispatch: patch
    plot-implement: patch
    plot-reconcile: patch
-->
