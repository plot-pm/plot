---
'@plot-pm/board': patch
---

A hidden board page holds no event stream and sends no poll. When the tab hides, the page closes its `/api/events` stream, releases the shared Web Lock or aborts its waiting request, closes its relay, and clears the 30 s `/api/board` and 4 s `/api/fleet` intervals. When the tab shows again, the page reopens the stream, refetches the board once and restores both intervals. With several tabs, a hidden stream holder hands the stream to the next visible tab.

<!--
plan: docs/plans/2026-11-08-no-tab-no-pulse.md
-->
