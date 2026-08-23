---
'@plot-pm/board': patch
---

board: rename Endgame phase to Testing

The phase after Development is now called Testing rather than Endgame. This
reflects what actually happens there: a fully-merged plan sits in that column
waiting for verification before delivery. The name "Testing" communicates the
activity; "Endgame" communicated only position.

Updated:
- `BOARD_PHASES` enum value
- `PHASE_LEADERSHIP` record key
- `toBoardPhase` mapping for `'delivered'`
- `phaseDateOf` switch case
- `PHASE_ACCENT` CSS class mapping
- All test fixtures and assertions

The rename is cosmetic — no behavior changes. A plan whose every wave has merged
still auto-bumps to this column; the Deliver action still gates on phase and
merged state the same way; the card's accent color stays violet.
