---
'plot': patch
'@plot-pm/board': patch
---

The fleet writes a Design plan's spec: `auto-design.ts` runs one spec-writing agent per eligible plan, pushes its branch, and opens a draft PR once the spec has content — composing `refsGit` with `refsRemoteGit`'s real `remoteSha` so a stale or claim-only branch deletes cleanly against its actual remote tip. `plot-design.mjs restart <slug>` resumes a halted or refused plan from the board or the CLI, and `/plot-fleet --status` and `GET /api/fleet` report the pass's halt, running plans, refusals and *Waiting on you* rows alongside verification. A going spec run now holds a fleet-size slot the same way a going verify run does.

<!--
plan: docs/plans/2026-10-12-the-fleet-writes-the-design.md
bumps:
  skills:
    plot-fleet: minor
-->
