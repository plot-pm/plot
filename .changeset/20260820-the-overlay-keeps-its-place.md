---
"@plot-pm/board": patch
---

board: the worker-log overlay locks the page and keeps its place

`WorkerLogModal` set `overflow-hidden` on its own panel and nothing on the body,
so a wheel that reached the backdrop scrolled the fleet list behind the open
panel — and closing it left the reader somewhere other than where they opened
it. The overlay asserted a modality it did not enforce.

The App scrolls the window (a `min-h-screen` document, no inner scroller), so
hiding the body's overflow alone would not have been enough: removing the
scrollbar reflows the layout and displaces the reader on its own. The lock is
`position: fixed` pinned to the captured `scrollY` instead — a fixed body cannot
take a wheel, and the exact offset is restored on close. One mechanism covers
both guarantees the plan names: no background scroll while open, the same place
on close.

Two browser assertions, one per guarantee: a wheel over the backdrop does not
move the page behind it, and the scroll position after close equals the one at
open. The restore test opens from a small non-zero offset on purpose — the panel
opens from a row menu at the top of the list, and a large offset would let
Playwright's scroll-into-view reset the page to 0 before the panel mounts,
measuring the harness rather than the lock.

<!--
bumps:
  skills:
-->

No skill version bumps: this is board-side only. The fix lives entirely in
`WorkerLogModal.tsx` — no helper script, plan format or `docs/plans` layout is
touched.
