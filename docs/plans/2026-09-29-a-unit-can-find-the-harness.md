# A unit can find the harness

> Both units set a PATH and both comments name the same three binaries — *git, gh and node*. Neither names `claude`, which on this machine lives in `~/.local/bin`. A supervisor-started worker exits 127 before it writes a line, and that is indistinguishable from a worker that started and did nothing.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1068
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 0

## Changelog

- A supervisor-started worker finds its harness, or refuses with the reason instead of exiting 127 three times.

Board impact: none. This is the unit and the prompt template.

## Motivation

Reported 2026-09-29 alongside #1067: a supervisor-started worker exited **127 three times** — `claude` not on PATH. The operator worked around it in their own `.plot/worker-prompt.sh`.

### Both units have the gap, and both say why they should not

`units/com.plot-pm.registryd.plist:50-53`:

```xml
<!-- git, gh and node must be findable: launchd gives a job a minimal PATH
     and none of the three is on it. Add homebrew's prefix for your arch. -->
<key>PATH</key>
<string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
```

`units/plot-registryd.service:38-39` says the same thing for systemd, with the same three binaries and the same omission.

**The comment enumerates what a job needs and `claude` is not in the list** — yet `templates/worker-prompt.sh:136` is `harness="${PLOT_HARNESS:-claude}"`, so the harness is exactly what a dispatched worker runs. Measured here: `command -v claude` → `/Users/jwloka/.local/bin/claude`, which neither unit's PATH contains.

### Why it is worse than a missing binary

**`exit 127` before the first line is written looks identical to a worker that started and did nothing.** There is no transcript, no `PLOT-BLOCKED`, no message naming the binary — and the loop retries, so the operator sees three of them. Every layer above reports a worker that ran and produced nothing.

## Design

### The rule

**A worker that cannot find its harness says so and stops. A unit's PATH names every binary the job actually runs.**

Two halves, and they fail differently:

1. **The PATH gap is a default.** `~/.local/bin` is where `claude` installs for the reporting operator and for this machine. Adding it to both units' PATH is a one-line change per unit.
2. **The refusal is the part that survives a wrong guess.** Whatever the PATH says, a harness that is not found must produce a named refusal rather than `exit 127`. `templates/worker-prompt.sh` knows the name — it is `$harness`.

**The second matters more.** A PATH list is a guess about where a binary lives, and it will be wrong on some machine; a refusal naming the missing binary is right on every machine.

### An installed unit does not update itself

**This is the same caveat #1051 and #1053 carry.** A unit is filled at install time, so an operator on an existing fleet keeps their old PATH until `--stop` then `--start`. The plan adds no other upgrade path, and the slice must say so in the changeset — a PATH fix nobody re-installs is a fix nobody gets.

### What this does NOT do

- **It does not probe for the harness at install time.** `plot-board-probe.sh` is the precedent for probing, and it answers a question with several right answers; this one has a name the template already holds.
- **It does not change `PLOT_HARNESS`.** An operator naming their own harness is served by the same refusal.
- **It does not add a retry.** Three exits at 127 is the current behaviour and the refusal replaces it — retrying a missing binary cannot help.
- **It does not touch the supervisor's own PATH needs**, which are `node` and already satisfied.

## Done when

- **A worker whose harness is not on PATH refuses with the binary's name**, asserted with a stub PATH that omits it. This is the half that works on a machine nobody anticipated.
- **The refusal is distinguishable from a worker that ran and produced nothing** — a `PLOT-BLOCKED` marker, a log line, or an exit record naming the harness. The slice picks one and says which.
- **Both units' PATH include `~/.local/bin`**, asserted by reading the filled unit, and **both comments are updated to name the harness** — the comment enumerates what a job needs and it was the thing that went stale.
- **A worker that CAN find its harness is unchanged**, asserted.
- **The changeset says an installed unit needs `--stop` then `--start`**, because a PATH baked in at install time is not updated by pulling.

## Slices

### A unit can find the harness (Branch: bug/a-unit-can-find-the-harness)

Add `~/.local/bin` to both units, name the harness in both comments, and make a missing harness refuse by name instead of exiting 127.

## Notes

**Reported by an operator who had already fixed it locally.** Their workaround lives in their own `.plot/worker-prompt.sh`, which `plot-install-prompt.sh` never overwrites — so their fleet works and every other adopting project hits the same wall.

**The units' comment is the tell.** It names three binaries and was written before the harness was a variable; `templates/worker-prompt.sh:136` made it one and nothing went back to the list. This is the shape `#1053` records for systemd unit names: a list maintained by hand beside a value that moved.
