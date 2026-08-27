---
"plot": minor
"@plot-pm/board": patch
---

A wave reads `eligible` only where a dispatch would actually take it; a wave held
by its plan's phase says `unapproved` instead.

**The measured bug**: `plot-fleet-scan.sh` computed the verdict from wave
ORDERING alone — `eligible` meant *no earlier wave blocks this one* — and readers
took it to mean *I can start this*. Those coincide only for an approved plan.
Measured 2026-08-27 on the live board: every one-wave plan in `not-started` read
`eligible`, and `plot-dispatch.sh` refused all six with *"plan '<slug>' is still
Draft — nothing may be dispatched."* Six of six unstartable, wearing the word a
reader acts on.

**The fix is in the scan, not the board.** `--next` and `plot-dispatch.sh`
consume the same verdict, so suppressing the word client-side would have left the
board and the dispatcher meaning different things by it — relocating the
disagreement rather than removing it.

1. `plot-fleet-scan.sh` withholds `eligible` from a wave whose plan is not
   approved and reports `unapproved`. The phase was already parsed for the
   terminal grouping, so this adds a test rather than a read: **no new file read
   and no host call**.

2. The gate is an **allowlist of `approved`**, mirroring `plot-dispatch.sh`'s own
   (`case "$gate_phase" in approved) ;;`). A `draft`-only denylist would let
   `design`, `UNKNOWN` and `NONE` inherit the good word — the blocklist-collapse
   shape this codebase keeps removing.

3. `--next` and `--list-eligible` inherit the answer, because both are fed from
   the same verdict rather than a second computation. The scan's verdict and its
   startability answer cannot disagree.

4. `complete` still outranks the new word: a wave whose branches have all merged
   is complete whatever its plan says. Only the word a reader ACTS on is withheld.

5. **Not `blocked`.** That word means *an earlier wave has not landed*, which
   resolves by merging work; this resolves by a person approving the plan.

6. The board's `WaveVerdictSchema` learns the fourth word. This is not cosmetic:
   `readBridge` parses the whole pulse through `FleetPulseSchema` and catches
   failures by returning `null`, so one unrecognised verdict would have discarded
   the **entire pulse** and blanked the board.

`plot-dispatch.sh` is unchanged — its phase gate stays the enforcement, and this
stops the fleet describing work that gate will refuse.

<!--
bumps:
  skills:
    plot-fleet: minor
-->
