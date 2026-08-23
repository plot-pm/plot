---
'@plot-pm/board': minor
---

board: the fleet row carries its sprint

`AgentRow` gains a **`sprint`** field — the slug of the active sprint whose
member list names the row's plan, or `""` where none does. Set in the server at
row creation by joining the row's plan slug to the sprint files' member lists;
never derived in the renderer from `planFile`, the same rule `kind` follows.

- Membership is read from the **sprint file's** `- [ ] [slug]` list (via
  `collectSprints`), not from the plan's own `Sprint:` field. On this estate 19
  plans are listed and only 5 carry the back-reference, so joining on the field
  would show a third of the commitment and hide the rest.
- `sprintMembership` builds the `slug → sprint` map from the ACTIVE sprints only,
  filtering on the sprint's phase rather than trusting the `active/` symlink
  index. A Closed sprint left linked by drift cannot claim a row.
- Where two sprints are Active and both list a plan, the first wins —
  deterministic, matching the first-wins dedup the member list itself uses.
- Rows with no plan (a release row, an unplanned PR) carry `""`, so the filter
  that later consumes this field keeps them visible.
- Read on the render clock — one directory read per pulse, no host call. The
  pulse fetches every plan once; this field only records which sprint a row
  belongs to.

No client change and no filtering yet: this wave puts the field on the row;
later waves read it.
