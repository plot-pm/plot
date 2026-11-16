# Round 2 verdict: contradiction lens

Position: amend

## 1. Did the round-1 amendments hold?

Verified by reading code and sibling plans.

- Role chip owner (plan 4, `feature/delivery-agent-roles`, waits `feature/delivery-section-header`): holds. The sibling plan `delivery-fleet-rows-per-agent.md` uses that exact branch name, owns the chip, and says plan 3's By column waits on it. `AgentRole` at `delivery-placement.ts:92` has six roles, as the plan says.
- Waits markers: `feature/delivery-section-header`, `feature/delivery-you-groups` (plan 2), `feature/delivery-agent-roles` (plan 4) all exist under those names. No cycle found. `you-groups` waits `section-header` and `tickets-section`, `tickets-section` waits `section-header`, and plan 1's `my-sprint-scope` and plan 5's `release-plan-rows` wait on `work-items-gates`, never the reverse. `by-chips` waits `agent-roles`, which waits `section-header`, so the "every slice waits on section-header" settled question holds transitively for the By slice only.
- Not-started exclusion and Start (plan 5): holds. Plan 5 says "not-started slices leave Work items" and gives Start in To do. `isUnbegun` is real but lives at `packages/board/src/app/lib/agent-rows/row-identity.ts:77`, not in the domain. The plan gives only the bare file name, which a builder will not find in `packages/domain`.
- `prUrl` is `() => null`: verified at `AgentList.tsx:1097`. `GATE_MARK` at `delivery-row-form.ts:91` and `gateValue` at `:139`: verified. Start `dispatch` at `AgentList.tsx:1219`: verified.
- `FIXER_ATTEMPTS_BUDGET = 2` at `rules/fixer-attempts.ts:5`: verified. `entities/fixer-attempts.ts` exists.
- Queued rule: consistent with `workGroup` (`delivery-placement.ts:226-240`): `building` with no live agent goes to `queued`, and `building` with a stopped agent goes first to You > Unblock `agent-died` (`:221`). The plan's "no live agent and no stopped agent" matches.
- Open Point 6 (Draft/Design/approval-owed in Queued) is still `[ ]`, a question for Jan. It matches `workGroup` (`:228-229`) and is open by design, not a contradiction.

## 2. Claims the source does not support

- Line cite "`delivery-row-form.ts:221`" for the `null` cell rule: the rule is in the TSDoc at `:215-216`; `:221` is the end of the doc block. Off by about 6 lines. Verified.
- Done When says each gate mark is "linked to the PR's checks or review", but the existing `gateLinks` (`:228-233`) emits a `review` link only when review is not `unread` and not `none`. So `review –` (none) has no link, and the plan's `–` mark contradicts "each linked". The existing `ci-run` link also needs a `ciRun` string, which the plan says is never set. A new PR-checks link target is needed (`LinkTarget` in `delivery-link-targets.ts`); the plan names none. Verified by reading.
- "An unread gate renders no cell" is only partly reachable. `workGroup` (`:233`) returns `null` (no placement) for a `pr` stage item whose `ci` is `unread`, so an unread CI never reaches a Work items row. Only review `unread` can produce an absent half. Design example `CI ✗ validate · review –` is also not met (plan records the check name as a gap, which is the honest part).
- The plan says gates "side by side"; current `gateValue` (`:141`) returns only the CI part when CI is read and ignores review. The plan's "extends `gateValue`" is correct but understates that the return type changes from one string to two marks, and `RowCells` cells hold one value plus targets (`:33`). Inferred from reading; no test run.
- Design says Where is "the PR, with the branch beneath it"; the plan adds "written in full" and a Done When line. No design text says "in full" (the design is silent). Not a contradiction, an addition.
- Design row for At a gate says each gate is "linked to its run or review". The plan links to the checks page instead and records the gap. Disclosed deviation.
- `ROW_COLUMNS` is `kind, item, where, status, do, by, age`. The plan's columns (group column between Where and By) are not those; the plan does not say whether the group column replaces `status` or is new, and plan 4 says it keeps `ROW_COLUMNS` for item rows. Verified at `:13`.

## 3. What a builder must guess

- Where the "earlier slice" for Waits on comes from. `waitsOn` exists on the reading (`delivery-readings.ts:187`, `delivery-row-facts.ts:48`) but only from `blockedBy`; the plan says "waits marker or slice order" and names no field. Inferred.
- Which column key the group column uses and the Age/By cells of agent-less rows.
- The commit count: `local_ahead` exists (`entities/fleet.ts:412`, set at `plan-walk-assembly.ts:506`), but the plan does not say how it reaches an item row's facts.
- Whether the By slice may land before plan 4 finishes the `reviewer` and `fixer` readings; it waits only on the roles branch.

## 4. Most serious gap

The gate-link contradiction in section 2 (`review –` linked versus unlinked, and no link target for a PR checks page). It is fixable by editing the plan: state that `–` carries no link, name the new link target, and correct the line cite. No sibling or design contradiction is fatal, and the waits graph is acyclic. Amend.
