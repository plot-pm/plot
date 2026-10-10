# The refs corpus test fails when no remote branch carries changes

> The pinned clone always holds one branch with changed paths, so the pin guard keeps its power on an estate where every slice has merged.

## Status

- **State:** Released
- **Type:** feature
- **Issue:** #1403
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-10-09, jwloka, in-session
- **Started:** 2026-10-09, jwloka, `feature/the-refs-corpus-test-fails-when`
- **Delivered:** 2026-10-09
- **Released:** 2026-10-10, v2.25.0

## Changelog

- The refs corpus test no longer fails on an estate where no open branch carries unmerged changes; the pinned clone supplies its own branch with one changed path.

<!-- Board impact: none. The change is confined to packages/domain/corpus/ and touches no plan format, template, helper script or docs/plans layout. -->

## Motivation

`packages/domain/corpus/refs.corpus.test.ts:538` (*pinned the clone, so the two scans were asked about one estate*) asserts that at least one wire branch has a non-empty `changed_paths`. The assertion reads the live estate of the pinned clone, not a fixture.

Main CI fails on this assertion from `588c91635` (#1391) onwards with `AssertionError: expected 0 to be greater than 0`. The run on `c6861cd46` passed. The #1391 merge left no open slice branch with unmerged changes on the remote, so the guard finds nothing to count. Every PR on main now fails the `corpus` job, including the release-record PRs #1397, #1399, #1400 and #1401.

The guard exists to catch a pin that reads nothing: on 2026-10-08 a clone whose pin was a local branch gave `read_ref: unknown`, `plan_source: worktree` and `changed_paths: []` on all 18 branches. The fix must keep that power and must not depend on whether an open branch exists. The same file already applies this rule twice — at `:468` (`changed_ago_seconds`) and in the variety check below `:538` — where *"variety is a property of the estate, not of the code"*. The `changed_paths` floor is the third instance and the one still written against the estate.

## Design

### Approach

`pinClone` (`packages/domain/corpus/pin-clone.ts:86`) builds `source.git` from ROOT's `refs/remotes/origin/*`, so the clone's `origin/*` equal ROOT's remote branches. The fix adds one fixture branch to `source.git` in that step: a branch with one commit on top of the pinned SHA that touches one known path. The clone then carries `origin/<fixture>`, and `changed_paths_of` (`plot-fleet-scan.sh:2356`, `git diff --name-only origin/$MAIN...origin/$1`) returns that path.

The guard then asserts on the fixture branch by name — its `changed_paths` equals the one known path — instead of counting branches whose changes are a property of the estate. A broken pin still fails it: with `read_ref: unknown` or an absent `origin/*` the scan reports `changed_paths: []` for the fixture too.

Two conditions decide whether the scan reports the fixture at all, and both need a measurement before the design is fixed:

1. **A plan must name the branch.** The scan reports only branches that a plan on the pinned ref names in `## Slices`. A branch no plan names never reaches the wire. Two candidates: (a) reuse a branch name that a plan on the pin already declares and whose remote ref is absent, or (b) commit a fixture plan onto a commit above the pin. Option (b) moves the pin, and the guard's `pinned?.pinned.startsWith(String(raw.read_ref))` check reads the pin's SHA.
2. **The scan must ask the conflicts question.** `plot-fleet-scan.sh:4908` emits `changed_paths` only where `conflicts_known` is `true`, which depends on the branch state. A branch whose plan is delivered, or whose PR the host reports as merged, may never reach that arm.

The commit is built with `git commit-tree` in `source.git`, so no working tree and no checkout are needed, and ROOT's objects and refs stay untouched.

### Open Questions

- [ ] Which plan names the fixture branch — an existing plan on the pin (option a) or a fixture plan above the pin (option b)? Option (a) depends on the estate again, through the plan list rather than through the remote refs.
- [ ] Which branch state makes `conflicts_known` true, and does the scan ask the host for the fixture's PR? A host call for a branch that exists only in a disposable clone answers `none`, which is the wanted state, but it costs one call per run.
- [ ] Does the fixture branch change any other assertion in the file? The field comparison, the `moved` floor at the end and `summary.branches` all count branches, and the fixture adds one.
- [ ] Does `production.ts`'s `readFleetScan` run the scan against the clone for both sides, so production and the adapter both see the fixture?

## Slices

### The Pin Carries Its Own Branch

- `feature/the-refs-corpus-test-fails-when` — `pinClone` adds one fixture branch with one changed path to the clone, and the guard at `refs.corpus.test.ts:538` asserts on that branch by name <!-- builds: a fixture branch in pinClone's source.git --> → #1408

## Notes

- Created unattended from issue #1403 by `/plot-idea`; the Type `feature` came from the request.
- The deliverable search for `pinClone` and *corpus fixture branch* found no existing fixture-branch mechanism; `pinClone` itself is the function this plan extends.
