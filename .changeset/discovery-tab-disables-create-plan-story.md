---
'@plot-pm/board': patch
---

The Discovery tab's Create plan and Create story buttons now read the tracker's reachability from `/api/board`'s `issueAnswer` instead of the Delivery-tab-only `/api/fleet` poll, so a fresh `?tab=discovery` load no longer shows both buttons as refused with "this git host has no issue read" on a host whose issue read works. The cache now seeds `issueAnswer` as `null` ("not read yet") rather than `unsupported`, and a shared domain rule, `createFromIssueVerdict`, decides `available`/`pending`/`refused` for both buttons from one place.

<!--
plan: docs/plans/2026-10-28-discovery-tab-disables-create-plan-story.md
bumps:
  skills:
    plot: patch
-->
