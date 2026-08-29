---
"@plot-pm/board": minor
---

Add sprint modal overlay to the Stories tab. Clicking a sprint link now opens a modal showing:
- Sprint title, phase, and release target
- Start and end dates
- Sprint goal (highlighted)
- Progress bar with completion count
- MoSCoW-grouped plan members with checkmarks and "Delivered" badges

The modal works both for sprints with files in `docs/sprints/active/` and for sprints synthesized from plan references (when a plan's `Sprint:` field names a sprint with no file).

Fix plan links in story content. Relative links like `[plan](../../plans/2026-08-16-slug.md)` are now rewritten to `/plan/slug.md` board routes. Also fix symlink resolution: plans accessed via symlinks in `active/` or `delivered/` now resolve correctly (previously failed when the symlink name differed from the date-prefixed filename).
