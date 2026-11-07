# Session: State Branch Plan

**Date:** 2026-11-07
**Focus:** Research into lifecycle writes against a protected default branch, and the Design plan `state-branch` through `/plot-idea`

## Accomplished

### Research (a hand-off from a session in another workspace)

- Read every write site that pushes at the default branch. On the ladder: approve, deliver, release-finish, verify, needs-design, record-pr, brief-book, through `commitAndPush` (`packages/board/src/server/entry/ladder.ts`, five attempts). Off the ladder: `write_started_record` in `plot-dispatch.sh` (no retry), the direct flow of `plot-idea`, `plot-sprint`, `plot-reject`, the RC push of `plot-release`.
- Read the identity of each push. GitHub origins push through the Writer App, which sits on the ruleset bypass list. Other origins push as the ambient identity (`plot-push-main.sh:100-102`).
- Read the branch restrictions of 17 Bitbucket repositories of one organisation through the host's web UI, because the CLI token lacks the scope (HTTP 403). 4 let nobody push to the default branch, 7 let only named people or the CI account push, 5 restrict nothing, and 1 workspace repository lets a staff group push. 7 require 1 approval for a merge, 5 of those also a passing build. Every restriction matches only the development branch of the branching model; no repository restricts another branch name.
- Listed the readers that take `origin/<default>` as the truth: the board's plan list (`fleet.ts:1598`), the reconcile scan (`plot-reconcile-scan.sh:1223`), dispatch's `gate_ref` (`plot-dispatch.sh:2688`) and brief read, and the pulse.
- Found no prior art for a state branch, an orphan branch, git notes or `refs/plot/*` as a record store.
- Measured the sweeps: no sweep deletes a `plot/*` branch by pattern. The reconcile scan enumerates only declared prefixes, `plot-release-refs.sh` deletes only a delivered plan's slice branches, and dispatch deletes only the local `plot/start-<slug>` it made.

### The plan

- Ran `/plot-idea state-branch`. Slug and branch collide with nothing; no active plan's title overlaps. Deliverable search: `State branch`, `plot-push-state` and `stateRef` match nothing in the estate; `PlanRef` exists in `plan-reference.ts:139` with another meaning, so the read rule takes a different name.
- Max Albrecht decided: Type feature, Review pr, Impl own branches, Design yes, every write that pushes at the default branch moves to the state branch, and the design decides when the state branch merges back. Max added a second motivation: in several repositories a merge to the default branch deploys a live test environment, so a state-only commit redeploys it.
- Wrote `docs/plans/2026-11-07-state-branch.md` in `State: Design` with three slices (Write as the spike, Read, Sync), nine open questions, and the alternative the plan must beat: a bypass identity on each repository's push exemption list.
- Opened draft PR #3231 from `idea/state-branch`.

## Files Modified

- `docs/plans/2026-11-07-state-branch.md`
- `docs/plans/active/state-branch.md`
- `sessionlogs/2026-11-07-state-branch-plan.md`

## Commits

- `plot: An opt-in plot/state branch syncs agent state past a protected default branch`
- `docs: sessionlog for the state-branch plan`

## Pending

- [ ] Fill in `## Spec` of the plan; the nine open questions name the decisions.
- [ ] A named person approves the Design plan: `/plot-approve state-branch --who <handle>`.
- [ ] `test/reconcile/no-bundle-diff-gate.test.mjs` assumes `git init` creates `master`. On a machine whose `init.defaultBranch` is another name, its six tests fail with `no merge base between feature and master`. The fixture should name its base branch. Not changed in this session.

## Notes

- The repo gates (`scripts/check-*.sh`) pass on this branch. The gate tests pass except the six above, which fail on this machine before the change as well.
- The session ran in a Claude Code worktree under `.claude/worktrees/`, which had no `node_modules` and no Node 26 on its path. `pnpm install --frozen-lockfile` with Homebrew's `node@26` fixed both.
