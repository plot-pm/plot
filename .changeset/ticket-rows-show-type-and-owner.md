---
'@plot-pm/board': minor
---

The Waiting-on-you ticket block shows one sub-header above the rows, and each row carries the tracker's type and owner beside its title, the same domain rule the Discovery ticket card already used. The sub-header reads `Assigned to you · N` only where the board matched the reader and lists only their tickets; with *show every ticket* on, for an unmatched reader, or where the server sent no assignment answer, it reads `Open tickets · N`. With *show every ticket* on, a ticket keeps the owner the server resolved.

<!--
plan: docs/plans/2026-10-16-ticket-rows-show-type-and-owner.md
bumps:
  skills:
    plot: patch
-->
