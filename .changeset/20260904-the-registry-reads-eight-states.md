---
'@plot-pm/board': minor
---

The registry reads the eight states `plot-worker-state.sh` answers, plus its own
`unknown` — so a failed agent stops reading the same word as an agent nobody
looked at.

**Why this exists**: four state vocabularies described one thing.
`entities/agent.ts` had eight, `entities/fleet.ts` eight,
`plot-worker-state.sh` eight, and the board's `AgentStateSchema` **five** —
folding `failed`, `ended`, `none` and `elsewhere` into `unknown` inside
`KNOWN_STATES`. `bashLiveness` received all eight and discarded four on arrival.
`DESIGN-agent.md:797` recorded it: *"The shell and the contract agree on eight;
only the registry disagrees."*

The four name different next moves. A recorded non-zero exit is a worker to look
at; an absent record is a worker that never ran; a worktree on another machine is
a question this one cannot answer. `unknown` means *nobody looked*, and reporting
a measured answer as an absent one sends a reader to find evidence the desk
already held.

The enum is now built from the domain's, so the two cannot restate each other
into disagreement again.

**Both classifiers move with it.** `isLiveState` is a denylist — anything but
`finished`, `stalled` and `unknown` read as live — so widening the enum alone
would have rendered four dead states in WORKING, which is
`the-working-section-shows-every-worker`'s defect running backwards. `failed`
joins `isBrokenState`, and `ended`, `none` and `elsewhere` are neither live nor
broken: each says no worker is here, and an agent with no process is not a
problem report.

`drop.ts` carried a second copy of the same four-state list and refused a
`failed` agent with *state could not be verified*. A recorded exit is
verification; it reads the registry's `KNOWN_STATES` now.
