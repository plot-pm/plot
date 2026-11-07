# branchClaims reads file-list lines in Slices as branches, so a release refuses

> `branchClaims` counts a backticked file path under a slice's `### Tests` or `### Documentation` heading as a branch claim, so `plot-deliver --release` refuses plans whose every slice merged.

## Status

- **State:** Delivered
- **Type:** bug
- **Sprint:**
- **Issue:** #3213
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-07, Jan Wloka, plan-PR #3218 merged
- **Started:** 2026-11-07, Jan Wloka, `bug/branchclaims-reads-file-list-lines-in`
- **Delivered:** 2026-11-07

## Changelog

- `plot-deliver --release` no longer refuses a plan because a file-list line under a slice names no `→ #N`; only a list line whose token starts with a configured branch prefix is a branch claim.

Board impact: the board server calls `branchClaims` in `deliver.ts`, `release-chain.ts` and `slice-claims.ts`, so the board artifact rebuilds. The plan format does not change.

## Motivation

`LIST_CLAIM` (`packages/domain/src/rules/cross-repo-reference.ts:39`) accepts any top-level `` - `<token>` `` line whose token matches `[A-Za-z0-9_./-]+`. A file-list line such as `` - `skills/plot-fleet/SKILL.md` `` under `### Tests` or `### Documentation` in `## Slices` therefore becomes a claim with `reference: null`. `releasePr` (`packages/domain/src/rules/release-tag.ts:62`) then answers `none`, and `plot-deliver --release` refuses with "names no '→ #N' annotation on a slice that was not deferred". The message is wrong: every real slice line carries its PR and each PR merged.

Measured 2026-11-07, during the 2.31.0 booking sweep (`POST /api/release` per Delivered plan of sprint `2026-W45-follow-ups-2-30-1`): 6 of 27 plans refused for this reason.

- `continue-and-the-agent-panel-refuse` (→ #3176, merged)
- `controller-gate-refuses-read-only-commands` (→ #3153, merged)
- `open-plot-review-findings-from-the`
- `partial-board-pulse-reported-as-unknown` (→ #3181, merged)
- `plot-fleetctl-stop-unloads-another-checkout` (→ #3107, merged)
- `restart-refuses-unknown-branch-when-it`

`plot-plan-meta.sh` reads the same plans correctly (`branches: ["bug/plot-fleetctl-stop-unloads-another-checkout"], prs: [3107]`), so the two parsers disagree on one plan format. Other callers of `branchClaims` share the defect: `sprint-member.ts`, `slice-claims.ts`, `release-chain.ts`.

## Design

### Approach

A list line in `## Slices` is a claim only where its token is a branch: the token starts with an entry of the `Branch prefixes` config key, the test `plot-plan-meta.sh` applies.

- `branchClaims` takes the prefix list as a parameter. The domain holds no project configuration, so each caller reads `Branch prefixes` and passes it in.
- `HEADING_CLAIM` (`(Branch: <name>)` in a heading) names a branch explicitly and stays as it is.
- A corpus test at `packages/domain/corpus/` runs `branchClaims` and `plot-plan-meta.sh` over the plans in `docs/plans/` and fails on a disagreement, per `docs/shell-and-domain.md`. The six plans above join it as fixtures.
- The repair after the fix is operational: re-run `POST /api/release {"slug":"<slug>","version":"2.31.0"}` for the 6 plans.

### Settled Questions

- A repository with no `Branch prefixes` key uses the default list `idea|feature|bug|docs|infra`, the same default `plot-plan-meta.sh:329` applies. The domain holds that list once, and the shell keeps its copy under the corpus comparison. With no default, every plan in a repository without the key would lose all its list claims. Settled by jwloka, 2026-11-07.
- A list line whose reference is `→ owner/repo#N` is a claim whatever its token's prefix. An `Impl: other repo` slice names a branch in the other repository, which can use a prefix this repository does not declare, and without this rule such plans lose their branches. Settled by jwloka, 2026-11-07.

## Slices

### Fix

- `bug/branchclaims-reads-file-list-lines-in` — filter list claims by branch prefix, thread the prefixes through the four callers, add the corpus comparison against `plot-plan-meta.sh` <!-- builds: branchClaims prefix filter, a corpus comparison with plot-plan-meta.sh --> → #3222

## Notes

Source: tracker issue #3213. Created by `/plot-idea` unattended; the plan stops at Draft and nothing is written to the tracker.
