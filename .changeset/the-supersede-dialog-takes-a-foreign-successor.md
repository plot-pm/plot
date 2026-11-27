---
'@plot-pm/board': minor
---

The board supersedes a plan by a plan in another repository. `POST /api/supersede` passes a string `by` to the controller trimmed, so `owner/repo:slug` answers 200 and a malformed reference answers 422 `successor-unparsed`; a `by` that is not a string still answers 400. The Supersede dialog reads its entry through `successorReference`: it accepts `owner/repo:slug` beside the datalist of local slugs, and refuses an empty entry, an unparsed one and the plan's own bare slug. A Superseded plan's card shows `superseded by <name>`, with `· unverified` for a successor in another repository, from `progress.successor` in the plan's card facts.

<!--
plan: docs/plans/2026-11-27-supersede-names-a-plan-in-another-repository.md
bumps:
  skills:
    plot: minor
-->
