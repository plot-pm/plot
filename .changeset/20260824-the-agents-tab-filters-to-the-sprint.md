---
'@plot-pm/board': minor
---

board: the Agents tab filters to the sprint

The Agents tab gains a **sprint filter** — one row per Active sprint, each with
a toggle, release target, and status counts (`delivered`, `deliverable`,
`inProgress`, `approved`). Toggling a sprint shows only rows whose plan belongs
to that sprint; plan-less rows always pass.

- **The control** renders the `fleet.sprints` payload from the sibling wave and
  toggles a local filter Set. One row per active sprint, each independently
  toggleable. Two sprints may be Active (two teams, one train), so the control
  supports multiple selections.
- **Disabled when no sprint is Active:** the control stays visible but disabled,
  showing the disabled state so readers learn the control exists. A control that
  vanishes teaches nobody it exists.
- **Plan-less rows always pass:** rows with `sprint === ''` — release branches,
  unplanned PRs — are not hidden by the filter. Hiding them would erase real
  work that happens to have no sprint membership.
- **Applied before `rowsBySection`:** the filter decides WHICH plans to show;
  the sections decide WHERE those rows belong. Filtering after sectioning would
  have the same effect but re-filter per section.
- **NOT persisted:** this is a momentary focus (what am I working on right now)
  rather than a standing preference. Persisting it would restore a filter that
  no longer matched the reader's task.

The counts are the point, not decoration: `deliverable` is the actionable one —
plans whose every wave has merged and whose delivery decision is outstanding.
