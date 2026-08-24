---
'@plot-pm/board': patch
---

board: the Board-tab sprint filter reads the sprint file

The Board tab's sprint filter now joins on the sprint **file's member list**
(`sprint.members`) rather than the plan's `Sprint:` back-reference field
(`card.sprint`). This is the same membership rule the Agents tab already uses.

The plan measured: 19 plans in the sprint file, only 5 carry the `Sprint:`
back-reference, 14 have empty/placeholder/absent fields. Joining on `card.sprint`
showed 5 of 19 — a lie about the sprint's contents.

- **File membership wins for sprints WITH files:** for sprints that have a
  directory entry in `board.sprints`, membership comes from the sprint file's
  `- [ ] [slug]` lines, not from `card.sprint`.
- **Fallback for inline-only sprints:** for sprints named only on plans (no
  sprint file exists), we fall back to `card.sprint` matching — so repos without
  sprint files still work.
- **Deferred plans excluded:** plans in the sprint file under `### Deferred` are
  not counted as members, matching the Agents tab behavior.
- **One rule, both tabs:** `sprintMembershipLookup`, `passesSprintFilter`, and
  `withSprintCounts` are now shared between the Board tab and the Swimlanes view,
  using the same membership derivation the Agents tab has always used.
