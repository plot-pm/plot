---
'@plot-pm/board': patch
---

The Delivery tab's "Only my work" control no longer claims "no identity configured" during the gap before the board's own slower fetch answers — `AgentList` mounts as soon as the faster fleet poll lands, which is usually first, and the hint used to render against an identity that simply had not arrived yet rather than one the board had genuinely found empty.

<!--
plan: docs/plans/2026-10-19-only-my-work-says-no-identity.md
-->
