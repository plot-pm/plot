# A foreign slice reads its own PR

> The fleet scan reads a slice that names `→ owner/repo#N` by that PR's number, the way `deliverabilityOf` does, so the scan, the board and `/plot-deliver` give one answer about a split-home plan.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:**
- **Issue:** #3762
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-28, jwloka, plan-PR #3763 merged

## Changelog

- The fleet scan reports a slice in another repository as `merged` when the PR its line names (`→ owner/repo#N`) is merged. A PR that the host cannot read leaves the slice `foreign`, and the scan names the read as unknown.

<!-- Board impact: a merged foreign branch row reads `merged` rather than `foreign`; the plan card's slice count is unchanged where the branch-name read already answered merged. -->

## Motivation

Issue #3762, observed on Plot 2.36.1 in a Bitbucket checkout: a plan with a local slice naming PR 16 of its own repository and two foreign slices naming `ws/portal` PR 31 and `ws/apps-infra` PR 176, both merged. `plot-impl-status.sh` read the `ws/portal` PR 31 as `MERGED`; `plot-fleet-scan.sh` read both foreign branches `open`, held the second wave `blocked`, and `plot-fleetctl.sh --once` offered `feature/entra-client-credentials` for hand-over.

PR #3743 (merged 2026-11-27, not yet released) fixed the hand-over and the blocked wave on main. A slice line that names another repository reads `foreign` (`packages/domain/src/rules/branch-state.ts:404`). Dispatch refuses it as `branch-foreign` (`packages/domain/src/rules/auto-dispatch.ts:748`), and `startabilityVerdict` offers no start for it (`packages/domain/src/rules/verdict.ts:57`). The walk asks `host.prMerged(branch, { repo })` for an arrowed foreign line (`packages/domain/src/workflows/plan-walk-branches.ts:449-457`), and a `MERGED` answer settles the slice (`packages/domain/src/workflows/plan-walk-assembly.ts:324-332`), so the wave opens and the board's `progress.work` counts the slice complete (`packages/domain/src/rules/eligible.ts:124`, `packages/board/src/server/board.ts:3922`).

Three differences remain on main:

- The branch row of a merged foreign slice reads `foreign — lives in <repo>, not claimed here` (`packages/domain/src/workflows/plan-walk-report.ts:66-67`), while `plot-impl-status.sh` reads the same line `MERGED`.
- The walk asks by branch name (`prMerged(branch, { repo })`, `plan-walk-branches.ts:454`). `deliverabilityOf` asks by the PR number the line names (`host.prState(ref.number, { repo: ref.repo })`, `packages/board/src/server/controllers/deliverability.ts:204`) and folds several references with `unknown` over `not-merged` over `merged` (`:206-210`). The two reads answer different questions, so the scan and `/plot-deliver` can disagree about one plan.
- The walk reads a failed host call and an unmerged PR both as `unreadable` (`plan-walk-branches.ts:455`). Nothing tells a host that did not answer from a PR that is still open.

## Design

### Approach

- **One resolution, two callers.** Move the per-reference read and fold of `deliverabilityOf` (`deliverability.ts:202-216`) into a domain rule that takes the `prState` answers of a branch's `owner/repo#N` references and returns `merged`, `not-merged` or `unknown`. `deliverabilityOf` and the walk both call it. The walk asks `prState(N, { repo })` for each reference, not `prMerged(branch, { repo })`.
- **A merged foreign branch reads `merged`.** Where the rule answers `merged`, `branchState` returns `merged` for a foreign branch, so the report, the wave settle and `progress.work` read the same state as for a local branch. `foreignSettled` (`plan-walk-assembly.ts:325`) becomes the ordinary `merged` test.
- **The index never says no.** A `not-merged` answer keeps `foreign`. An `unknown` answer (a failed call, no permission, a cross-repo probe that misses on both backends) also keeps `foreign`, and the report names the PR read as unknown. The branch state is never `unknown` or `open` for a foreign line, because both are startable (`verdict.ts:64-74`) and a foreign branch must never be handed over here.
- **A line with no arrow is unchanged.** A foreign line that names no `#N` puts no question and stays `foreign`, as on main.
- **No second implementation in shell.** `plot-impl-status.sh` keeps its own resolution; the slice adds a test that the walk and `deliverabilityOf` give one answer on the reporter's fixture.

### Open Questions

- [ ] `[question-host-cost]` How many host calls does a scan pass add? Recommended: one `prState` per `owner/repo#N` reference of a live plan per pass, the same count `prMerged` costs today for one reference per line; measure it on the fixture and state the number in the PR.
- [ ] `[question-terminal-cache]` Should a `MERGED` foreign answer be kept across passes, like a terminal `MERGED` row in the PR index? Recommended: yes, in a later plan. A merged PR cannot revert, so the licence of "Only a terminal answer is read from the index" holds, but the PR index keys rows by this repository's branch and holds no foreign repository.
- [ ] `[question-several-references]` A branch line may name references in several repositories. Recommended: the walk uses the same fold as `deliverabilityOf`, so one open or unreadable reference keeps the branch `foreign`.

## Slices

### Own PR

- `bug/a-foreign-slice-reads-its-own-pr` — the walk resolves a foreign slice's `→ owner/repo#N` through the rule `deliverabilityOf` uses, and a merged foreign branch reads `merged` <!-- builds: crossRepoMergeState, one rule for a branch's cross-repo references --> <!-- tests: first run the reporter's fixture against main and record what still differs — a plan with a local slice naming PR 16 and foreign slices naming ws/portal PR 31 and ws/apps-infra PR 176, both merged; on the branch the fixture reads all three `merged`, the second wave eligible, and the walk and deliverabilityOf agree; a not-merged foreign PR reads foreign; a failed prState reads foreign with the PR read unknown, never open or unknown state; a foreign line with no arrow asks nothing; a branch with two references, one open, reads foreign -->

## Notes

Created on 2026-11-28 from issue #3762, for the sprint fleet-runs-safely-alone.
