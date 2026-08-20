---
"@plot-pm/board": patch
---

board: the note distinguishes a spent rate limit from an unreachable host

Both footer notes reported every host failure the same way — *PR data
unavailable (…)* and *Open issues could not be read* — so a spent GraphQL
budget read as an outage. Measured 2026-08-20 while the board was live:
GraphQL 0/5000, resetting in ~8 minutes, rendered as *unavailable*, a word
that promises no end.

A rate limit is a THIRD state, not a variant of the outage
(`2026-08-20-a-rate-limit-is-not-an-outage.md`): partial, temporary, and with
a known end. `hostErrorState` reads the failure's kind off the same
`/rate limit/i` signal the backoff already keys on, so the note and the fetch
cannot disagree about what happened. When the kind is a rate limit the note
SAYS so and NAMES when service returns — from `prNextInSeconds`, the reset the
sibling wave taught the fetch to wait for. The issue note stops claiming the
tracker *could not be read* for a budget that was refused rather than failed —
a check it never ran.

An unreachable host keeps today's wording verbatim: `an-outage-is-not-an-answer`
holds, and a rate limit collapses into neither `unreachable` nor `unasked`.
