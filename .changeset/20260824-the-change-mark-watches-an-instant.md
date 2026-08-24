---
'@plot-pm/board': patch
---

The change mark watches the INSTANT of the newest write rather than the age of
it. `changed_ago_seconds` is recomputed against `now` on every scan, so watching
it flashed every row that had one on every pulse, forever — while rows with no
worktree, and so no age, never flashed at all. The scan now carries `changed_at`
beside the age; the age remains for display.
