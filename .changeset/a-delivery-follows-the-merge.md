---
'plot': patch
---

The board's Deliver action accepts a plan as soon as the host reports its last slice merged, without a wait for the next PR read and pulse. A refusal names the branch that the host reads open, and a host that cannot answer refuses as `merge-unconfirmed`, never as "not merged".

<!--
plan: docs/plans/2026-11-16-a-delivery-follows-the-merge.md
bumps:
  skills:
    plot-deliver: patch
-->
