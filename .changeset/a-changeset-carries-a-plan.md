---
'plot': minor
---

A changeset can name the plan it implements, on a `plan:` line beside its `bumps:` block. `/plot-release`'s cross-check reads it as a lookup where it is present and falls back to the semantic match where it is absent — 0 of 19 changesets named a plan, so the link is optional and its absence is not a finding. `rules/changeset.ts` parses `plan:` and `bumps:` together, and refuses either written before the description: `plan: docs/plans/x.md` is 21 characters, one over the floor, so it would otherwise publish as the release note.

<!--
plan: docs/plans/2026-09-06-a-changeset-names-its-plan.md
bumps:
  skills:
    plot: minor
    plot-release: minor
-->
