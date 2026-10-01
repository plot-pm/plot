# Round 1: operator lens

**Looked at:** the plan and issue #1161 on `origin/main` (`5da3e923`); `fleet.ts` `classifyGroup` (`:4096`, `:4119-4130`, `:4446-4472`, `:4485-4501`, `:4593-4745`, `:5016-5060`, `:5108-5146`, `localActivity` `:5475-5510`); `schema.ts:1588`; `eligible.ts:107`; `verdict.ts:60`; `sections.ts` (`sliceSection`, `rowsBySection`, `sliceGroupsFor`, `sectionTally`); `AgentList.tsx:1465-1500`; `menus.tsx:96-121, 290-305`; one `/api/fleet` read.

Position: amend

## Findings

**The citations hold.** `:4471` reads `return { group: 'waiting-on-you', note: DRAFT_PLAN_NOTE };`, `:4744` reads the same, `:5125` reads `return { group: 'not-started', note: \`waits for ${prerequisite}, which has no pull request\` };`, and `schema.ts:1588` reads `export const DRAFT_PLAN_NOTE = 'plan not approved yet — still in review';`. `eligible.ts:107` and `verdict.ts:60` match their claims.

**Live count: 1 row moves, not 15.** Commit `5da3e923` approved sixteen plans this morning. The 15 rows in the issue now belong to Approved plans, so they stay in NOT STARTED correctly. One row moves: `an-in-session-approval-has-a-controller` / `bug/the-scripts-own-the-approval-and-the-release` (`blocked`, `verdict: unapproved`). WAITING ON YOU goes from 6 to 7 rows. It stays readable.

**Grouping.** The rows stay together. `sliceGroupsFor` has no `length > 1` threshold. Each single-branch Draft slice therefore groups, `loose` is 0, and `planHeads` holds (`sections.ts:470`). The moved row renders under the same plan head as its open sibling, and the head carries Approve (`menus.tsx:297`). `rowsBySection` does not relocate it, because `sliceSection` returns null for `unapproved`.

**Row text.** The later slice reads the draft note, and `waits for <branch>` disappears until approval. That is acceptable, because the head is one decision. The plan does not state this loss, though.

**NOT STARTED after the change.** An Approved plan's `blocked` slice keeps `waits for …`, which is correct. `bug/the-queue-reads-the-assignment` reads `verdict: eligible` with state `blocked` under *approved — nobody has taken it*. That predates this plan and is out of scope.

## Required changes

1. **The invariant claim is false for paths the rule leaves alone.** For a Draft plan, these paths still return `not-started` while the payload carries `verdict: unapproved`: `claimed` within the quiet window (`:5054`, *claimed, no known worker*), `wip` with a recent commit (`:5146`), `open` with a held or dirty worktree (`localActivity` via `:4683-4684`), and `claimed`/`wip` reaching `localActivity`. The Changelog line *"no longer pairs `verdict: unapproved` with `group: not-started`"* and the issue's Done-when cannot both hold. The plan must do one of two things. It can narrow the Changelog line and the Done-when to the five states it covers. Or it can send these `localActivity`/claim-window paths for a Draft plan to WAITING ON YOU (or WORKING) and say which.
2. **The "every BranchState" test passes or fails depending on fixture defaults.** With `ageMinutes: null` and no worktree it passes. With a recent age, or `localAhead > 0`, it fails on `claimed` and `wip`. Name the fixture readings, or assert only over the five states the rule decides.
3. **State the lost wait sentence** in the Changelog: a Draft plan's later slice says the draft note and not `waits for …`.
4. **Minor:** the moved row gains Open (`menus.tsx:121`) to a `branchUrl` with no remote ref. The open draft row has the same defect. Name it as out of scope.
