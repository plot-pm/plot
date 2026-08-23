---
"@plot-pm/board": minor
---

The Agents tab states how many parallel-agent slots are in use, beside the cap
it already showed. The count is the same one the dispatcher measures the cap
against, published by the server rather than re-derived in the client — a second
implementation is how a control comes to disagree with the rule it describes.

Liveness now takes two facts rather than one. An agent occupies a slot when its
process is live **and** its branch has not landed: measured 2026-08-24, seven
registry entries reported a live pid and five sat on branches whose pull
requests had merged hours earlier, so five of twelve slots were charged to
nothing and the fleet declined to dispatch work it had room for.
`plot-worker-state.sh` cannot make this call — it answers about the process, and
the board is where both facts meet.

`working` is optional and absent is not zero: a payload from an older server, or
a pulse that could not read the registry, renders nothing rather than an idle
fleet.

The agent registry (`.plot/agents/`) is no longer committed. A manifest holds a
pid and an absolute worktree path — machine-local for the same reason
`.plot/state/` already is. The board reads the directory, never git, so the
registry is unaffected.
