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

### The interrogation (`/challenge-the-plan`, seven rounds, Max Albrecht answering)

- Sixteen decisions fill `## Spec`, D1 to D16: fleetd opens the sync PR and the host's rule merges it; readers list both refs and the state ref wins per path; a forward-merge conflict refuses and names the file; the default is the branch `plot/state`, and the key may name any full ref, where a non-branch ref gets no sync PR from Plot; the board shows one phase plus a lag line; a sync PR changes only files Plot writes; fleetd merges the default branch into the state ref every tick it moved; the Write slice is proved by a rejecting pre-receive fixture and a protected e2e sandbox; a removed key is reported by reconcile; `plot-init` proposes the key and offers a delete restriction; the sync PR squash-merges and opens when a plan reaches Delivered; the state gate accepts a merge from the state ref's tip; one push lock per repository.
- The revisit criterion Max named: an alternative must be simple, safe and sound for both the CI problem and the CD problem, and make less noise in the repository.
- Round 7 came from a review of the Spec's consistency: a repository with no fleet has no actor for either sync, which the team decides as Open Question 12; a locally merged sync PR squashes as the host does, so D12 and D14 agree; the `(round N)` tags left the Spec, since the metadata block holds that history; the PR leaves draft.
- Three items stay with the team: the read rule's name (candidates `recordRef`, `planSource`, `stateBranchRef`), the cut of the slices, where a fourth slice for `plot-init` and `plot-board-setup` is the candidate, and the repository with no fleet. The Spec says it is not complete until the third is answered.
- `Rounds: 7` and the `CHALLENGE-THE-PLAN-METADATA` block record the rounds; `plot-plan-meta.sh` reads `rounds: 7`.

## Files Modified

- `docs/plans/2026-11-07-state-branch.md`
- `docs/plans/active/state-branch.md`
- `sessionlogs/2026-11-07-state-branch-plan.md`

## Commits

- `plot: An opt-in plot/state branch syncs agent state past a protected default branch`
- `docs: sessionlog for the state-branch plan`
- `plot: state-branch plan names the unprotected-but-deploying case`
- `plot: state-branch plan carries its Spec after six interrogation rounds`
- `docs: sessionlog records the state-branch interrogation`
- `plot: state-branch plan settles the local squash and names the no-fleet gap`

## Pending

- [ ] The team names the read rule, cuts the slices and decides the no-fleet case (Open Questions 7, 11 and 12), then a named person approves the Design plan: `/plot-approve state-branch --who <handle>`.
- [ ] `test/reconcile/no-bundle-diff-gate.test.mjs` assumes `git init` creates `master`. On a machine whose `init.defaultBranch` is another name, its six tests fail with `no merge base between feature and master`. The fixture should name its base branch. Not changed in this session.

## Notes

- The repo gates (`scripts/check-*.sh`) pass on this branch. The gate tests pass except the six above. Their cause is this machine's `~/.gitconfig.local`, which sets `init.defaultBranch=develop`, so the fixture's `master` never exists; the plan file plays no part in it.
- The session ran in a Claude Code worktree under `.claude/worktrees/`, which had no `node_modules` and no Node 26 on its path. `pnpm install --frozen-lockfile` with Homebrew's `node@26` fixed both.
