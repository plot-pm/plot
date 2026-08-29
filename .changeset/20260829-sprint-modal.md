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
