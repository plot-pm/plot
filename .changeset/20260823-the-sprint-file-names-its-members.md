---
'@plot-pm/board': minor
---

board: parseSprintFile reads a sprint's members

`parseSprintFile` now reads a sprint's **members** — the `- [ ] [slug]` /
`- [x] [slug]` lines, each slug, and the MoSCoW tier it sits under. Until now no
code parsed the member list, so the board could only join plans to a sprint on
the plan's self-declared `Sprint:` field — which is why the active sprint showed
6 of its 19 plans.

- `SprintMember` is added to the contract (`slug`, `tier`, `checked`, `known`);
  `SprintCard.members` carries the list, defaulting to `[]` so an empty or
  hand-built card stays valid.
- Members are deduped by slug (a plan sliced across waves lists once), with the
  first occurrence winning so a plan keeps its strongest tier.
- `### Deferred` items are carried as their own tier — in the file, not a
  commitment — so the consumer can exclude them from counts.
- A slug naming no plan is REPORTED (`known: false`), never dropped: a sprint
  listing a renamed or deleted plan must still show it, or its own scope is
  unknowable. `collectSprints` resolves the flag against the plans the board
  found; `parseSprintFile` reading the file alone cannot tell, so it emits
  `known: true`.

No client change and no filtering: this wave produces the list; later waves join
on it.
