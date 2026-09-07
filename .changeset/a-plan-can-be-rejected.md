---
'@plot-pm/board': minor
---

`reject()` and `supersede()` in `transitions/plan.ts` give the two states a writer. Both already existed and neither was reachable: `PlanState` declares them, `plot-plan-meta.sh` accepts them, `plot-reconcile-scan.sh` files both under the delivered index, and the board drops such plans from its cards. Only the transition was missing, so six plan files carry these states written by hand — three `Superseded` and three `Rejected`, measured 2026-09-07 against the four the plan found.

They are two verbs rather than one with a flag. `rejected` is a verdict and its record carries the reason, because three of the six hand-written files record a date, a person and a channel and no reason at all — a file saying somebody said no, with nothing an author can act on. `superseded` is a relation and its record names the replacing plan. A shared verb would make both fields optional, and then neither is required.

Two refusals are new: `reason-missing` and `successor-missing`. Landed work cannot leave the lifecycle — `delivered` and `released` refuse `state-terminal` — and a plan that already left it one way cannot leave it the other.

The wire format and the `Phase:` field are untouched, the two record fields are optional on `TransitionPlan` so every existing construction site typechecks unchanged, and the six hand-written files parse with their states intact. Neither verb is reachable from a script: both are tree-shaken out of every board bundle, because nothing calls them.

<!--
plan: docs/plans/2026-09-04-the-workflow-owns-the-word-phase.md
bumps:
  skills:
    plot: minor
-->
