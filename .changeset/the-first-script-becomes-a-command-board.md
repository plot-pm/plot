---
'@plot-pm/board': patch
---

Adds `packages/board/src/server/entry/deliver.ts`, the first bundle under `entry/` that performs a lifecycle write rather than answering a reading on stdin — it creates a booking worktree, writes a plan's `State:`/`Delivered:`/`Released:` record, moves the index symlink, ticks the sprint item, and commits and pushes, falling back to a micro-PR on a rejected push. Declared as `shippedDeliver` in `build.mjs` and shipped at `skills/plot/scripts/board/plot-deliver.mjs`, which `plot-deliver.sh` now launches.
