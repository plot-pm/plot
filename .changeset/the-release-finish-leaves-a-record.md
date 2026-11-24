---
'plot': patch
---

Every release finish now records its outcome in `.plot/state/release-finish/v<version>.json` under the state home: `booked`, `refused` or `already-released`, the refusal's reason, the caller, the booked plan slugs, the notes and the closed sprint. A second finish of the same version replaces the record, and a failed write prints `record-unwritten` and changes neither the outcome nor the exit code. The Delivery tab's `unbooked` row shows `last finish: <reason>` after a refused finish; the record decides no placement.

<!--
plan: docs/plans/2026-11-24-a-merged-release-books-its-plans.md
bumps:
  skills:
    plot-release: patch
-->
