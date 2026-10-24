---
"@plot-pm/board": patch
---

Fixed three Delivery-tab chip defects, all decided in `@plot-pm/domain`'s `chipRow` rather than in the component: a per-sprint chip hardcoded `hiddenCount: 0` instead of asking the domain (new `perSprint` chip shape, one per Active sprint, each with its own hidden count); the `This sprint` chip counted hidden rows against every Active sprint instead of the reader's current selection; and `rowInSprintSelection` let an empty selection admit a row that belongs to no Active sprint, contradicting its own documented contract. Also fixed `Mine`'s identity: `chipRow` built the chip's label and enabled state from a `gitEmail` fallback that `isMine`'s ownership match can never compare against a host login (#2476), so the chip reported itself as actionable while filtering nothing — `identityOf` now reads `hostUser` only, and a `gitEmail`-only reader sees a disabled reason naming that specifically.

<!--
plan: docs/plans/2026-10-24-delivery-chips-and-waiting-on-you.md
bumps:
  skills:
    plot: patch
-->
