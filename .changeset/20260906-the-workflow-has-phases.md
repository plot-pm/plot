---
'@plot-pm/board': minor
---

The development workflow now owns its phases. `DevelopmentWorkflow` in `entities/workflow.ts` holds `Discovery → Design → Development → Testing → Released`, their order, and who leads each; `rules/phase.ts` holds the mappings onto them and re-exports the phases from it.

`BOARD_PHASES` was declared twice byte-identically — `domain/rules/phase.ts:12` and `board/contract/schema.ts:202`, verified no-diff on 2026-09-06 — while `schema.ts:1095` already re-exported `toBoardPhase` from the domain. The board imported the function and hand-copied the values it operates on; it now imports both. `PHASE_LEADERSHIP` moves with them, icon included: who leads Discovery against who leads Testing is a fact about how a team works, and the icon is how that leader is named without colour.

A story maps too. `toBoardPhase` took a plan state and nothing else, so a phase read as a property of one plan. `storyPhase` maps `StoryStatus`'s six values onto the same five phases — Discovery produces an approved story and Design produces plans from it, which is why `design` has been entered by 0 of 207 plans: a plan state naming a phase whose output is plans. `paused` maps to Development, the phase `active` maps to; pausing stops work and does not undo it.

The order is data and refuses nothing — the state transitions gate the work, and a second enforcer could only disagree with the first. What is asserted instead is that the two agree, with the edges read from `approvable`/`deliverable`/`releasable` and `storyStatusSettable` themselves rather than transcribed. The 11 existing `toBoardPhase` assertions pass unchanged.

<!--
bumps:
  skills:
    plot: patch
-->
