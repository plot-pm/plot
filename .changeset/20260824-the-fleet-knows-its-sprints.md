---
'@plot-pm/board': minor
---

board: the fleet knows its sprints

The `/api/fleet` payload gains a **`sprints`** array — one entry per Active
sprint, each carrying its **target release** and its four `status` counts
(`delivered`, `deliverable`, `inProgress`, `approved`). These are the numbers
the Agents-tab sprint control renders beside the sprint's name.

- The counts are a **tally of `plan.status`**, never a second computation of it.
  `planStatusBySlug` returns each plan's status from the ONE `planStatus`
  function; `activeSprints` joins the sprint's member slugs against that map.
  This is the field's FIRST CONSUMER — a fifth definition of *done* here is the
  exact defect `a-plan-has-a-phase-and-a-status` exists to end.
- Only the four post-approval statuses are counted. A `draft`/`open` member is
  committed to but not yet in flight, a `released` member has shipped, and an
  unknown slug names no plan the board found — each adds to nothing.
- A `### Deferred` member is excluded: a deferral is not a commitment, so a
  count that swallowed it would overstate the sprint.
- `SprintCard` gains a **`release`** field, read by `parseSprintFile` from the
  sprint file's `- **Release:** x.y.z` record — `""` where absent, because the
  control renders nothing rather than `→ —`.
- One entry per Active sprint (two teams may share one train); `[]` where none
  is Active, which the control shows as its disabled-but-visible state.
- Aggregated on the render clock from the same cached pulse the rows come from —
  one `docs/sprints/` read plus one plan-meta parse per render, no host call —
  and emitted unconditionally, because the client casts this payload and a Zod
  `.default([])` never fires client-side.

No control yet: this wave puts the payload on the fleet; the `Filtered` wave
renders it.
