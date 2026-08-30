---
'@plot-pm/board': patch
---

The first controller: fleet state, the question `/api/board` and `/api/fleet`
both serve. `/api/board` becomes parse, call, enrich, serialise.

**It is not HTTP.** `boardState({ opts })` takes typed arguments and returns a
typed result — no `host`, no port, no request — so the master agent can ask the
question a browser asks and get the same answer. It lives in the board rather
than the domain package because a controller knows about requests and callers,
and that knowledge is exactly what the purity gate keeps out of
`packages/domain/src`.

**The enrichment stays on the route, and that was the design question this
slice owned.** `server` is transport knowledge, and all ten `*Availability`
flags are the same kind of fact wearing a lifecycle name: every one answers
*did this request come from this machine?*, which is meaningless to a caller
that never made a request. A controller returning them would have to invent a
binding for the master agent.

**The origin check now exists once.** Measured 2026-08-30: six literal copies of
`host === 'localhost' || host === '127.0.0.1' || host === '::1'` across
`dispatch`, `continue`, `idea`, `implement`, `drop` and `story`, with four more
capabilities delegating to those. What differed between the six was never the
condition — only the sentence naming what is unavailable — so
`localCapability(host, what, owns)` shares the condition and keeps the sentence
a parameter. The ten flags stay ten fields: one flag serving several
capabilities is how they diverge unnoticed.

**The payload is unchanged byte for byte**, captured from the artifact before
and after against a real estate — 104609 bytes, 18 top-level keys — with two
baseline captures diffed against each other first, so a later difference could
only be the change.
