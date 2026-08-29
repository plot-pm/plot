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

Derive story status from plan phases:
- All plans released → archived
- All plans delivered → done
- Any plan approved → active
- Otherwise → draft

Redesign tag cloud as compact pills with variable sizing (larger topics get bigger pills) and highlighted border for selected tag.

Improve topic extraction with domain-focused approach: extract keywords from story slugs and compound terms from plan titles, with extensive stop word filtering for meaningful domain vocabulary.

Render markdown (bold/italic) in story card objectives.
