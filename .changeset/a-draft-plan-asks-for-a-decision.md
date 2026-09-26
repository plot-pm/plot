---
'@plot-pm/board': patch
---

A Draft plan with no branch now gets a WAITING ON YOU row on the Agents tab, naming its interrogation rounds and the sentence *plan not approved yet — still in review*. Every row on that tab derived from a branch, and branches are cut at dispatch after approval, so a plan was invisible there for its whole drafting life — measured 2026-09-26, `/api/fleet` served 28 rows and 0 Draft plans while one was being drafted. The fleet payload carries a new `draftPlans` field, read from the same plan-meta parse as the sprint counts; the plan estate is now parsed once per render instead of twice. A Draft plan that already has a branch row is not listed again, and a missing `Rounds:` field renders `not interrogated` where a recorded 0 renders `0 rounds`. The row offers no action.

<!--
plan: docs/plans/2026-09-26-a-draft-plan-asks-for-a-decision.md
-->
