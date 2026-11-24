---
'@plot-pm/board': patch
---

A person can book a merged release's plans as Released after the release PR is gone. `plot-ask.mjs release-finish <version>` and `POST /api/release-finish {"version":"<N.N.N>"}` read the version's tag and the merge that removed its changesets, book every Delivered plan the release owes and close its open sprint in one commit, and refuse an unattended caller. The Delivery tab places an owed release under You › Unblock: its row reads `unbooked · <version> · <n> plans`, names the plans and any open sprint, and its Book as Released button calls the route and shows the outcome or the refusal in place. The row reads fleetd's `release unbooked` finding while fleetd is live and the board's own reading otherwise.

<!--
plan: docs/plans/2026-11-24-a-merged-release-books-its-plans.md
bumps:
  skills:
    plot: patch
-->
