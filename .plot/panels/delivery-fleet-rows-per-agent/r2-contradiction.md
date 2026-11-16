# Juror r2: Contradiction

Position: amend

Looked at (ran grep/sed): the plan in full; the five sibling delivery plans' slice headings and `waits:` markers; the design's Fleet and Calls Made After Review sections; every file:line the plan cites. Not looked at: test files beyond locating `an-unnamed-desk-says-so.browser.test.ts`.

## Verified true (no action)
- Cited lines hold: `delivery-placement.ts:92` (six roles), `:262-267` (`agentGroup`); `delivery-readings.ts:302-303` (`role ?? 'loop'`, `blockedOn` only `person`); `fixer-attempts.ts:5,8`; `auto-review.ts:63` (3600000 ms); `AgentList.tsx:552`, `:1403-1418`, `:1430`; `fleet.ts:8612-8619`; `schema.ts:4340/4365`; `desk-manifest.ts:261`; `desk-lifecycle.ts:211`; `slice-tokens.ts:22-27`; `board.ts:459`; `slice-spend.ts:57-60` (7.7 MiB); `entities/limit.ts` exists.
- Slice order and branch names agree with siblings: plan 3's By slice waits on `feature/delivery-agent-roles`; plan 6 names the same slice for the plan-runs move; plan 1 names plan 4 as the Fleet header's owner; all waits resolve to slices that exist.

## Contradictions and gaps
1. Done When vs Approach on roles. Approach: "Where the slice finds no local reading for a role, that role shows no row". Done When: "Each of the eight roles maps to its reading and shows its chip ... asserted in unit tests". Both cannot hold for reviewer/approver/idea/brief runs whose runners write no local state. Fix: Done When says "each role with a local reading shows its chip; a role with none is listed in Notes and shows no row".
2. Layering. The Time left table takes the reviewer bound from `REVIEW_BOUND_MS` in `packages/fleet/src/shared/auto-review.ts`. The domain imports `zod` only (CLAUDE.md purity gate), and the plan makes the time-left fraction a domain property. The plan does not say how the bound reaches the domain. Fix: say the bound is an input to the domain rule (a reading), or that the constant moves into `packages/domain`.
3. Design says Waits on includes "review" (and "your answer"); the plan lists only `person`, `ci`, `rate-limit`. It does not say the review gate is deferred. Fix: name review as a gap in Notes, or add it.
4. Design says Tokens is "what the agent spent on its current run"; the plan shows the last finished run and "—" while running. The deviation is labelled and queued as an open Point for Jan Wloka (unchecked), but Changelog bullet 2 ("its output tokens") and Done When do not carry the caveat. Fix: state it in Changelog so the summary matches behaviour.
5. Header counts have no owner. Approach says the counts are plan 1's section summary "filled with the Fleet groups"; no slice here says it fills them (agent-rows builds groups; header-switches builds switches and tokens). Fix: name the slice that supplies the Fleet groups to the summary.
6. Shared-file ordering. `feature/delivery-agent-roles` (moves design/verify runs out of the "Tickets and plan runs" block, `AgentList.tsx:552`) and plan 6's `feature/delivery-tickets-section` (moves tickets out of the same block) touch the same code with no `waits:` between them; plan 6's own note defers the runs to plan 4's slice. Fix: one plan names the order, e.g. agent-roles waits on `feature/delivery-tickets-section`.
7. Stale metadata. Status says `Rounds: 1` and CHALLENGE-THE-PLAN-METADATA says round 1, while git history shows round 2 commits. Update on amend.
8. Worker bound absent or 0: `boundSecondsOf` substitutes 28800, while the plan's cached read does not say which it uses for the loop/design/verify bound. Fix: name the fallback.

No contradiction found with the terminology rules (Agent/Worker usage), arrow-function rule, or the agentGroup placement.
