---
'@plot-pm/board': minor
---

board: the contract carries a Wave, derived once server-side

A wave existed nowhere in the contract — it was rows that happen to share a
string, and everything a wave has (its verdict, its section, its completeness,
the branches it holds) was re-derived at every call site from a predicate the
caller chose. Five defects traced to those derivations disagreeing.

The fleet payload now carries a `Wave`: its identity (plan plus name), the
branches it holds, the scan's verdict unchanged, its ONE section, and whether it
is complete. It is derived once in `fleet.ts` where the scan's verdicts already
are — never in the renderer — so a consumer asking a wave-shaped question reads
one answer instead of computing its own. A wave has a verdict and inherits its
plan's phase; it never carries a phase of its own. The field defaults to `[]` so
an older payload still validates, and the server emits it unconditionally
because the client casts the payload rather than parsing it.
