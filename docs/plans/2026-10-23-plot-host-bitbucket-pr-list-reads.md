# Bitbucket pr-list reads every page

> `plot-host.sh pr-list` on Bitbucket reads one page of 50 PRs per state, so a PR older than the newest 50 in its state reads as "no PR". `bb pr list` now follows `next` links, and the listing can use it.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** bugfix-2-28-2
- **Issue:** #2400
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2402 merged
- **Started:** 2026-10-23, Jan Wloka, `bug/plot-host-bitbucket-pr-list-reads`

## Changelog

- On Bitbucket, `plot-host.sh pr-list` reads every page of a state's pull requests when the installed `bb` supports `pr list --all`, so a PR outside the newest 50 stops reading as "no PR". An older `bb` keeps the single-page listing and its notice.

<!-- Board impact: none. The listing's output shape does not change, only how many rows it can carry. No plan format, template or layout change. -->

## Motivation

`bb_state_listing` (`skills/plot/scripts/plot-host.sh:1286`) calls `bb api …/pullrequests?state=<s>&pagelen=$BB_LIST_PAGELEN` once and never follows `next`. Any PR older than the newest 50 in a state reads as "no PR".

The comment above the `--limit` notice (`plot-host.sh:4521`) says `bb pr list` refuses `--limit` with `unknown flag`. That is no longer true: `bb pr list` has accepted `--limit` since agent-skills v3.13.1 (2026-09-18), and it follows `next` links.

The fix depends on quatico-solutions/agent-skills#98 (`bb pr list` pagination, `--all`, `--updated-since`), planned for agent-skills 3.18.0 in the sprint 2026-10-26 to 2026-10-30. The local `bb` is 1.11.2, so no version measured here carries `--all`.

## Design

### Approach

Once agent-skills#98 ships:

1. `bb_state_listing` calls `bb pr list --state <s> --all --json`, or `--limit <n>` when the caller passes one, so the listing follows every page.
2. The `$PR_LIST_SINCE` window passes `--updated-since` to `bb pr list` instead of building `updated_on>=` in `q=` by hand. Both bounds are inclusive.
3. The stale "refuses --limit" comment and the `bitbucket ignores --limit` notice go once the listing honours the flag.
4. A capability gate on the `bb` version, in the way `bb_require_json` gates on `--json` support, keeps today's single-page behaviour and its notice for an older `bb`.

agent-skills#98 also adds a retry on HTTP 429 (up to 3 per page, honouring `Retry-After`) and a stderr warning when a listing without `--limit` is cut at 50 rows.

Places that hold the one-page assumption and need a read before the change:

- `bb_state_listing` and the `BB_LIST_NEXT_FILE` envelope reading, which exist because `bb api` returns the raw envelope. `bb pr list --json` returns rows, so the `next` signal changes source.
- `pr_list_report_truncation`, `BB_LIST_PAGELEN` and `BB_LIST_PAGE_VERSIONS`, plus the mirror in `packages/domain/src/adapters/host/listing-paging.ts` (`listingPagingFor`, `envelopeNextFor`). A listing that follows every page is complete by construction, and the completeness report changes with it.
- `bb_branch_query` and `bb_window_listing`, which compose `$PR_LIST_SINCE` into `q=`.

The layering rule holds: the change stays in `plot-host.sh` and the host adapter. No controller or rule gains a Bitbucket branch.

### Open Questions

- [ ] Which `bb` version carries `--all`: 3.18.0 of agent-skills is the plan, and the gate needs the `bb` version string it maps to.
- [ ] Gate by version table, as `BB_LIST_PAGE_VERSIONS` does, or by probing `bb pr list --help` for `--all`, as `bb_test_json_support` does for `--json`.
- [ ] Does `--all` have a ceiling for a repository with thousands of PRs, and does the 429 retry keep a cold scan inside the `Checks wait` and worker bounds? Measure on a large repository before the switch.
- [ ] #2385 proposes an append-only PR index that would read the full listing from this change. Does the index change what the listing owes, or only consume it?

## Slices

### Listing

- `bug/plot-host-bitbucket-pr-list-reads` — switch `bb_state_listing` and the `--updated-since` window to `bb pr list --all`, gated on the `bb` version; drop the stale comment and notice; keep the single-page path for an older `bb`. <!-- builds: bb_state_listing paging gate -->

## Notes

- Blocked on quatico-solutions/agent-skills#98 shipping. Approve and implement after agent-skills 3.18.0 is available.
- Related: #2385 (Bitbucket PR index).
