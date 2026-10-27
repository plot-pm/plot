---
"plot": patch
---

fleetd's tick now reads the merged branch set as a delta against the PR index rather than paying for an unconditional `pr-list --state merged --limit 500` every tick. Where the store decodes at the current version and reads `complete: true`, `mergedBranches` asks one narrower `pr-list --state merged --since <watermark − 60 s>` call and unions its heads with the store's own non-draft MERGED rows; a missing, old-version, unparseable or incomplete store, and any delta trouble (a failed call, a left-behind refusal, or a page that may have been truncated), fall back to the existing full call in the same tick. The tick line's `merged-set=` field gains a `(delta)` suffix on the path that answered this way.

<!--
plan: docs/plans/2026-10-26-an-idle-board-and-fleetd-spend.md
bumps:
  skills: {}
-->
