---
'@plot-pm/board': minor
---

Every Delivery section folds to its header line: Release delivery, You, Work items, Fleet, Machine, Tickets and Not placed. Each header has a 28 px fold button that carries `aria-expanded`, and a click elsewhere on the header row toggles the fold too, except on a count link or a switch. Not placed starts folded, and a stored fold set from an earlier version gains that default once. A folded section shows `— none` where it holds nothing, and a folded Fleet section keeps a loud supervisor alert. Every in-tab link uses one jump: it opens the section, group and plan row that hold the target, then scrolls to it. A link whose target Mine or the sprint scope hides shows as a disabled button that names the filter.

<!--
plan: docs/plans/2026-11-20-every-delivery-section-folds.md
-->
