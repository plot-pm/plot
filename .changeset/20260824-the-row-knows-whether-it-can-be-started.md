---
'@plot-pm/board': minor
---

board: the row knows whether it can be started

A NOT STARTED row distinguishes *ready to dispatch* from *needs a brief first*.

The defect these cover was measured on the live board 2026-08-19: nine rows
reading *eligible — nobody has taken it*, and zero briefs between them. The
wave arithmetic was right — every one of those branches genuinely was next —
and every dispatch the phrase invited would have started an agent that reads
`.plot/briefs/<slug>.md`, a file that was not there.

The fix adds a `startability` field to AgentRow with four verdicts:
- `start-work`: ready to dispatch a worker
- `needs-brief`: eligible but missing its brief file
- `waiting-on-approval`: plan is still Draft
- `someone-is-on-it`: branch is already claimed or WIP

The verdict is computed once on the server by `startabilityVerdict()` from plan
phase, branch state, wave verdict, and brief state. Predicates like
`isStartable()` and `needsBrief()` now read from the field rather than
re-deriving the answer — the single source of truth is what the server handed
to the client.

Rendering: `start work` shows green, other verdicts keep ordinary color.
`eligible` stays green for wave rows (the wave verdict is still news). Merged
or deferred branches have no startability verdict (null).
