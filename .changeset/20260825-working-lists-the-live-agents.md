---
'@plot-pm/board': patch
---

WORKING lists the workers that are working

**The section's subject is *who is working*, and it listed sessions that had
ended.** WORKING rendered one row per registry entry, so a complete pulse read
`WORKING (16)` over four live workers and twelve `stalled`/`finished`/`unknown`
sessions — the exact thing the endgame checklist says the count must not be:
the registry's size.

`workingAgentRows` now filters to the LIVE states — `running` and `waiting` —
before it joins to branch rows, and the `working` count applies the same rule,
so the count still equals the rows WORKING renders (#403's property, preserved).

The definition of a live worker moves to the contract as `LIVE_STATES`, imported
by both `auto-dispatch.ts` (the concurrency cap) and the board, so the dispatcher
and the board cannot drift on what a worker is. The filter reads it through a
denylist (`isLiveState`): a state known to be ended is excluded, and an
unrecognised sixth state — an older board reading a newer registry — is shown
rather than hidden, because a worker nobody can see is the worse failure.

A `stalled` or `unknown` entry is not lost; it reaches WAITING ON YOU as a
problem report in a sibling wave of the same plan.
