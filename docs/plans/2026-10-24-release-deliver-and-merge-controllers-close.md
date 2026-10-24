# Release, deliver and merge controllers close shared issues early and trust short shas

> The release closes a shared issue only after it reads every unreleased sibling plan, and the merge path pins a head only with a sha the host resolves.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** follow-ups-2-28-3
- **Issue:** #2480
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2505 merged
- **Started:** 2026-10-24, Jan Wloka, `bug/shared-issue-close-reads-every-sibling`

## Changelog

- Release no longer closes an issue that an Active or Delivered sibling plan still names, and the Jira status write honours the same skip list.
- A failed sibling read or an unparseable plan record stops the issue step with a report and does not fail the release after the push.
- `pr-merge-dest` reads every page, the release chain starts at the plan PR's merge time, and a missing merge commit gets advice that depends on `--no-fetch` and shallow clones.
- The merge path accepts a short sha only where the host resolves one.

Board impact: none expected. The board reads `deliver.ts` and `release-chain.ts` output through the same endpoints; a rebuilt artifact is not part of any slice.

## Motivation

Issue #2480 collects 27 plot-review follow-up findings (10 MEDIUM, 17 LOW) from eleven merged PRs (#2065, #2073, #2074, #2105, #2118, #2146, #2202, #2238, #2374, #2398, #2443), checked against `origin/main` at `84b1638e4` on 2026-10-24. They fall into five groups, and the MEDIUM ones in three of them change behaviour:

- **Shared issues close early (#2374).** `deliver.ts:917` lists only the Active index, so a Delivered unreleased sibling is ignored. `deliver.ts:903` applies the skip list to the close but not to the Jira status write. `deliver.ts:195` returns an empty set when the sibling read fails, and `deliver.ts:206` parses JSON without a guard after the release push has landed.
- **The release chain reports a wrong tag (#2238, #2202).** `pr-merge-dest` reads one page (100 on GitHub, 50 on Bitbucket) but promises every merged PR, and uses `updated_on` as the Bitbucket merge time. `release-chain.ts:153` starts the first hop with an empty `mergedAt`. `release-chain.ts:65` and `:67` print advice and a cause that nothing verified.
- **A short sha weakens an irreversible merge (#2105, #2118).** `same-commit.ts:2` accepts a 7-character prefix in the `head-moved` check. `MergeDetail.sha` documents the pinned head while the write pins `pr.headSha`.
- **Dead code and a false changeset (#2443, #2073).** `approve.ts:1006` holds a branch for a condition that cannot be true, so the changeset for #2407 claims a fix the code does not make. `gate.ts:598` keeps `pinUnavailable`, `UNPINNABLE_NOTE` and `canPinMerge` although `hostPinsMerges` always returns true.
- **Duplicated parsing, weak tests and comments (#2065, #2074, #2146, #2398).** The domain holds two remote URL parsers (`hostAndPath`, `pathOf`) beside `branchUrlBase`. `same-commit.corpus.test.ts` runs a copy of the shell expression instead of `plot-host.sh`. The generated CHANGELOG turns `#N` inside code spans into links.

## Design

### Approach

Each slice answers one group above and keeps the finding list in its own PR description, so a reviewer checks a finding against a diff. Every behaviour change starts from a failing test that names the finding.

- **Shared-issue close.** The release reads every unreleased sibling plan in Active and Delivered through the plan directory, not the Active index (see *A Decision Reads The Index*). It applies one skip list to the close and to the Jira status write. A failed read or an unparseable record stops the issue step after the push and prints a report; the release still succeeds. Sibling parsing goes through the existing plan readers and not a new `JSON.parse` site.
- **Release chain.** `pr-merge-dest` pages until the host reports no further page, and on Bitbucket reads the merge time rather than `updated_on`. The first hop compares its `mergedAt` with the plan PR's merge time. The missing-merge-commit advice depends on `--no-fetch` and on a shallow clone, and states no cause that nothing verified.
- **Short sha.** The merge path accepts a short sha only on a host that resolves one, and `approve.ts` posts the status at the full head sha. `MergeDetail.sha` names what the detail carries.
- **Dead code.** Remove the unreachable `approve.ts` branch and the `gate.ts` pin-availability code, and rewrite the #2407 changeset to say what the code does. Test names and comments in the findings state current behaviour.
- **One parser.** One remote URL parser serves `remoteSlug`, `branchUrlBase` and `pathOf` (the *one parser* rule that `remote-owner` already states). The same-commit corpus test runs the shipped `plot-host.sh`, per *A Shell Script Asks The Domain*. The CHANGELOG generator output keeps `#N` inside code spans as code.

### Open Questions

- [ ] Should the sibling read for the shared-issue check move into the domain as a rule over plan rows, or stay in `deliver.ts` beside the existing read? The first makes the skip list testable without a board.
- [ ] Is a 7-character prefix right on any host? GitHub resolves short shas in the commits API, and the Bitbucket merge arm re-reads the head, so the minimum may stay at 7 on one backend and rise to 40 on the other.
- [ ] Do the LOW findings on `CHANGELOG.md:4221` (comment-block indentation per release) and `bitbucket-slug.ts:8` (stale doc comment) belong in this plan, or in a separate docs/infra plan?
- [ ] Several findings may already be fixed on `main` after `84b1638e4`. The first task of each slice is to re-check each finding against `HEAD` and drop the fixed ones.

## Slices

### Shared issues

- `bug/shared-issue-close-reads-every-sibling` — release closes an issue only after reading Active and Delivered siblings, applies the skip list to the Jira status write, and reports a failed or unparseable read after the push without failing the release → #2578

### Release chain

- `bug/release-chain-reads-every-page-and-hop` — `pr-merge-dest` pages fully and uses the Bitbucket merge time, the first hop compares with the plan PR's merge time, and the missing-merge-commit advice follows `--no-fetch` and shallow clones

### Merge path

- `bug/merge-pins-only-resolvable-short-shas` — short sha accepted only where the host resolves one, `approve.ts` posts at the full head sha, `MergeDetail.sha` doc matches the value

### Cleanup

- `bug/remove-dead-pin-and-approve-branches` — remove the dead `approve.ts` and `gate.ts` code, correct the #2407 changeset and the test names and comments the findings list

### One parser

- `bug/one-remote-url-parser` — one parser behind `remoteSlug`, `branchUrlBase` and `pathOf`, the same-commit corpus test over the shipped `plot-host.sh`, and `#N` in code spans kept as code in the CHANGELOG

## Notes

- Source: issue #2480, <https://github.com/plot-pm/plot/issues/2480>. The plan writes nothing to the tracker.
- Created unattended. Skipped questions: Review and Impl answered from `Plan PRs: required` and a multi-slice scope; Design defaulted to no.
- Definition of Done: docs/definition-of-done.md.
