---
"plot": patch
---

The fleet scan reports a branch whose own tree holds a plan file as that plan's branch. A plan created with `Impl: same branch` lives only on its work branch until that branch merges, so enumerating `origin/<main>` alone left the branch carrying it as an anonymous row with `plan: ""` while the Board tab showed the same plan as a Draft card. The scan now also lists the plan directory from each prefixed remote branch, keeping the paths the default branch does not carry — the default branch wins a shared path, and among branches the first to carry it, so two branches cut from one point report one plan rather than several. Regular blobs only, so an `active/` symlink is not a second plan. Measured on this estate at 11 prefixed branches: +1.98 s CPU, +7.3%.

<!--
plan: docs/plans/2026-09-24-the-fleet-sees-a-plan-on-its-own-branch.md
bumps:
  skills:
    plot: patch
-->
