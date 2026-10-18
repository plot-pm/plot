---
'plot': patch
---

A released free desk's note — "ended after 8 h with no slice offered" or "ended at the wait bound" — now renders under Quiet instead of vanishing, because `EndedDeskPlacement` carries a `section` ('waiting-on-you' | 'quiet') that the board reads for both the Waiting-on-you filter and a new Quiet row, and `fleet.ts` reads `Worker bound` only when an entry's ending reads `freeWaitEnded` so the note words its hour count instead of defaulting to the wait-bound phrasing.

<!--
plan: docs/plans/2026-10-17-the-ready-line-waits-for-every.md
bumps:
  skills:
    plot: patch
-->
