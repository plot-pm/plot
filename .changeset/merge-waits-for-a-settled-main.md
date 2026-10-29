---
'@plot-pm/board': patch
---

`mergeAt` moves into `@plot-pm/domain` as a workflow over the `Host`, `Scripts`, `DefaultBranchStore` and `Refs` ports, so `@plot-pm/fleet` can reach it. `merge()` now refuses `default-branch-unsettled` unless a freshly-read remote tip matches the stored reading's head and settled commit, and refuses `review-not-passed` unless `plot/review` reads `success` on the pinned head — the checks rollup no longer stands in for either. `MergeInput` gains an opt-in `requireReading` flag that refuses `default-branch-unread` on a missing reading; `plot-ask.mjs merge` does not set it, so its behaviour on a missing reading is unchanged. `canPinMerge` moves alongside `mergeAt`, so `approve.ts` imports the one copy from the domain.

<!--
plan: docs/plans/2026-10-29-fleetd-merges-slice-prs-one-at.md
-->
