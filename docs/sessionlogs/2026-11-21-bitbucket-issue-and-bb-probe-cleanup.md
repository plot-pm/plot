# Session: Bitbucket Issue and bb Probe Cleanup

**Date:** 2026-11-20 to 2026-11-21
**Source:** Claude Code
**Focus:** Remove the Bitbucket issue code and the craftamap `--json` probe from Plot, after a board on a Bitbucket repository showed "bb 1.14.0 lists no issue command — Quatico bb has none, unlike craftamap/bb"

## Summary

Bitbucket Cloud keeps no issues, so `issueSource` now answers `nobody` for a Bitbucket repository with no external `Tracker`, and the shell's craftamap issue parser is gone (#3589, merged). The craftamap `--json` capability probe on every Bitbucket command is removed in #3639 (open).

## Findings

- The board ran in `qs-design-tests`: `Git host: bitbucket`, no `Tracker` key. `issueSource` sent it to the git host, and `plot-host.sh issue-list` met Quatico `bb` 1.14.0, which has no `issue` command.
- Bitbucket Cloud removed its issue tracker and wikis on 2026-08-20 (Atlassian Community post "Announcing sunset of Bitbucket Issues and Wikis"). `bb api repositories/quatico/qs-design-tests/issues` answers `HTTP 410 — CHANGE-3071 - Functionality has been deprecated`, and 0 of the 414 repositories in the `quatico` workspace report `has_issues: true` (2026-11-20).
- Max Albrecht stated the rule for `bb`: Quatico `bb` is the one supported `bb`, and a missing capability is added to it rather than worked around in Plot.

## Accomplished

- #3589 `plot: a Bitbucket repository with no Tracker asks no host for issues` (merged 2026-11-20 as `3c02e3d6a`): `issueSource` reads the new `hosts` field (`HOST_ISSUE_LISTERS`, now GitHub only), all 8 callers pass it, and `bbIssueCommandMissing`, `--bb-issue-missing`, `BB_ISSUE_VERSION` and both `bb issue` parsers are removed. The board sentence reads "the git host `bitbucket` has no issue list to read" with the `Tracker` remedy. The changeset is in release PR #3598 (2.36.0).
- #3639 `plot: a Bitbucket command calls bb with no --json probe` (open): `bb_identify`, `bb_test_json_support`, `bb_require_json`, the `BB_CAP_*` state, its 12 calls and `PLOT_BB_SKIP_CAP_CHECK` are removed. `bb_list_page_length` reads the version through `bb_read_version`, at most once per process.

## Decisions

- The Bitbucket decision lives in the domain rule, not in the shell: every caller asks `issueSource`, so a decision there reaches the board, fleetd's issue index and the reconcile scan without a host call. The shell keeps a fixed exit-4 sentence for a bundle built before the change.
- The `--json` probe went into its own PR, because it sits on the live PR path (12 call sites, the version that `bb_list_page_length` reads, the request-budget test).

## Open Findings

- `plot-host.sh pr-merged branch/that-never-existed-xyz` answered `merged` after 34 s on 2026-11-20 in this checkout, and `gh pr list --head branch/that-never-existed-xyz --state all` returned `[]`. `packages/domain/test/ports-real-state.test.ts` › *answers the merged question with three values* calls it and times out at 5 s. Not investigated.
- `BB_LIST_PAGE_VERSIONS="1.9.0"` in `plot-host.sh` and `BITBUCKET_PAGE_LENGTHS` in `listing-paging.ts` name only 1.9.0. With `bb` 1.14.0 installed, a Bitbucket listing whose last page leaves the length to decide reads as possibly truncated. A 1.14.0 row needs a measurement of `pagelen` through `bb api`.
- `test/reconcile/host.test.mjs` › *the .env parse handles every shape the gate names* fails on this machine with `main`'s `plot-host.sh` too (exit 3 on the `export-prefixed` shape).

## Next Steps

- [ ] Merge #3639 once CI passes; CI is the first clean run of `scan.test.mjs` for it.
- [ ] Approve release PR #3598 (2.36.0) so the board on Bitbucket repositories shows the new sentence.
- [ ] Declare `Tracker` in `qs-design-tests` if its tickets live in Jira.

## Repository State

- `main`: `3c02e3d6a` (#3589).
- Branch `experiment/bb-needs-no-json-probe`: `d12b6c649` and this sessionlog, PR #3639.
