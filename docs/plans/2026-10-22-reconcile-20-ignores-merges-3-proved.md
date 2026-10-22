# Reconcile §20 ignores merges §3 proved and names the wrong truncation limit on Bitbucket

> On a cut Bitbucket merged-PR list, §3 asks the host per branch and proves a merge, but §20 reads the cut list alone and prints "none"; both truncation notes print the requested limit (500) instead of the page the host applied (50).

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:**
- **Issue:** #2325
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:**

## Changelog

- `plot-reconcile-scan.sh` §20 lists a ref whose PR merged when §3 proved that merge with a per-branch `pr-merged` ask, and the truncation note in §2 and §20 names the limit the host applied.

<!-- Board impact: none expected. The board does not parse reconcile output; no plan format, template or docs/plans layout changes. Confirm at implementation. -->

## Motivation

On ewz-kus-portal (read-only field test, round 7, main `da789acff`, after #2282), §3 reports `bug/ewzkus-3678-sd-rechnungen-rechnungsliste` as "merged into develop, no open PR → deletion candidate" from a per-branch `pr-merged` ask. §20 in the same run prints "(none — no remote ref outlives its merged PR)".

The two sections disagree on one run for one branch. §3 (`plot-reconcile-scan.sh:1301-1310`) asks the host per branch when `MERGED_PR_TRUNCATED=1` on Bitbucket and keeps the answer to itself. §20 (`:2535`) reads `merged_pr_for_branch`, which searches only the bundled list that Bitbucket cut at one page of 50. The branch's PR sits past that page, so §20 skips it.

The truncation note reads "merged-PR list hit its limit of $MERGED_PR_LIMIT" (`:1189`, `:2571`). `MERGED_PR_LIMIT` is the requested 500 (`:399`). Bitbucket applied a page of 50, and `plot-host.sh` says so on stderr ("possibly truncated", `:3033`). The note therefore names a limit that never applied.

Issue: https://github.com/plot-pm/plot/issues/2325. Follow-up to `2026-10-21-reconcile-on-bitbucket-reads-merged-branches` (#2282), which added the §3 per-branch ask and the §20 note and left both gaps.

## Design

### Approach

1. **Share the per-branch answer.** When §3 proves a merge through `pr-merged`, record the branch and its PR number in the scan's merged-PR state, so `merged_pr_for_branch` returns it. §20 then lists the ref with the same evidence §3 used. The record holds an answer the host gave, never a verdict derived from ancestry (see *One Answer To "Did This Land"* in `CLAUDE.md`).
2. **Name the applied limit.** `plot-host.sh` already decides truncation and writes the row count to stderr. The scan reads that count, or a stable marker, and prints "merged-PR list was cut at N rows" in §2 and §20. On GitHub the note keeps `MERGED_PR_LIMIT`, which that host honours.

### Open Questions

- [ ] §20 enumerates refs and calls `merged_pr_for_branch` for each; §3 asks only for branches it would call orphans. Should §20 ask per branch for every remote ref with no row in a cut list (cost: one call per ref on a Bitbucket account with a scarce budget), or only reuse the answers §3 already bought? The recommended direction is reuse only, and a note in §20 that refs §3 never asked about may still be missed.
- [ ] Which signal carries the applied limit out of `plot-host.sh`: a parsed stderr line, or a distinct marker on stdout or an exit status? The scan may not call `bb` itself (`scripts/check-host-cli-callers.sh`).
- [ ] Does `review-bypass.ts --limit "$MERGED_PR_LIMIT"` (`:2592`) print the same wrong limit on Bitbucket?

## Slices

### Shared merge answer and applied limit

- `bug/reconcile-20-ignores-merges-3-proved` — §20 reads the per-branch merge answers §3 bought, and both truncation notes name the limit the host applied <!-- builds: a per-branch merged-answer record shared by reconcile §3 and §20, and an applied-limit signal from plot-host.sh for the merged-PR list -->

## Notes

- Test target: a contract test in `test/reconcile/` with a stubbed Bitbucket host that returns 50 merged rows plus a per-branch `merged` answer for a branch outside them. The test fails on `main` with §3 naming a deletion candidate while §20 prints "none", and passes when §20 lists the ref. A second assertion checks that the note names 50.
- Source: issue #2325 (https://github.com/plot-pm/plot/issues/2325). The plan writes nothing to the tracker.
- Overlap, named for the reader: `2026-10-21-reconcile-on-bitbucket-reads-merged-branches` (Delivered) and `2026-10-21-reconcile-does-not-report-a-plan` share the area; this plan changes §20 and the note only.
- Unattended run: Review answered `pr` from `Plan PRs: required`; Impl answered `own branches`; State is Draft because the prompt gave no `Design: yes`.
