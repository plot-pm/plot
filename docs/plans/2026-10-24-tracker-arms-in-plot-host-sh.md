# Tracker arms in plot-host.sh misread issue state and spend uncounted requests

> The Jira and Bitbucket `issue-view` arms decide open or closed from the wrong field, `issue-list --fix-version` spends requests the request count never sees, and the tracker port and its tests carry a list of smaller defects found in review.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** follow-ups-2-28-3
- **Issue:** #2483
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2523 merged
- **Started:** 2026-10-24, Jan Wloka, `feature/tracker-arms-issue-view-state`
- **Started:** 2026-10-25, Jan Wloka, `feature/tracker-arms-issue-list-counted`
- **Started:** 2026-10-26, Jan Wloka, `feature/tracker-arms-port-and-advice`

## Changelog

- Jira `issue-view` reads an issue as open or closed from `statusCategory.key` or the resolution. Bitbucket `issue-view` reads every closed state (`resolved`, `closed`, `invalid`, `duplicate`, `wontfix`) as closed.
- `issue-list --fix-version` checks that the version exists once per question, counts that request, and reports an unparseable version list as a failed question. `--limit` and `--state` are validated and documented.

<!-- Board impact: none expected. `issue-view` feeds the board's issue rows through the tracker port; slice 1 checks that the board reads the `state` field it already carries. -->

## Motivation

Follow-up findings from plot-review on twelve merged plans (#2200, #2205, #2223, #2224, #2234, #2237, #2239, #2247, #2259, #2275, #2308, #2365) are collected in issue #2483, checked against `origin/main` at `84b1638e4` on 2026-10-24. The issue lists 8 MEDIUM and 18 LOW findings. They fall into three groups.

1. **Wrong state.** `skills/plot/scripts/plot-host.sh:5207` decides Jira `open` from `statusCategory.name == "Done"`, which is localised, and ignores `PLOT_JIRA_JQL`. `:5253` reads every Bitbucket state except `RESOLVED` and `CLOSED` as open, so `ON HOLD`, `INVALID`, `DUPLICATE` and `WONTFIX` issues count as open. `test/reconcile/host.test.mjs:2119` asserts no `state` field for any of the three hosts, so a wrong mapping passes every test.
2. **Uncounted requests.** `:4937` re-checks that the fix version exists on every page call. The adapter already checks, so the request is repeated and escapes the request count. An unparseable version list reads as `version-not-found` instead of a failed question. The cut-result notice at `:5012` uses a stderr warning, which the sibling plan and the arm's own comment reject. `--limit` above bash integer range passes the regex and fails `-gt`, so Jira truncates silently. A later `--state` overrides `--fix-version` silently.
3. **Port and test drift.** The version-not-found marker is exported from `tracker-shell.ts` while the port contract defines it. `issueListLabelled` has no production caller (`ports/tracker.ts:264`). Two TSDoc blocks and one comment describe behaviour the code does not have. The Tracker scheme parse exists three times in `issue-source.ts`. A repository with no `Tracker` key gets advice that makes Jira the sprint owner. Four tests pass with the guard they name deleted.

## Design

### Approach

Three slices, in an order that keeps `plot-host.sh` conflicts out of the fleet: both shell slices edit the same file, so they run one after the other.

1. **`issue-view` state.** Jira reads `statusCategory.key` (`done`) or a non-null `resolution`. Bitbucket maps `resolved`, `closed`, `invalid`, `duplicate` and `wontfix` to closed. Jira `issue-view` honours `PLOT_JIRA_JQL` the way `issue-list` does. Host tests assert `state` for GitHub, Jira and Bitbucket, one case per closed state.
2. **`issue-list` arguments and request count.** The fix-version check runs once per question and the request goes through the counted path. A version list that `jq` cannot parse exits as a failed question. `--limit` is bounded before the numeric comparison. A later `--state` does not override `--fix-version`; the header documents the invocation the adapter uses. The cut-result notice moves to the mechanism the sibling plan chose. The `--bb-issue-missing` path accepts only the expected bundle answer, and its fallback sentence stops repeating `bb`. The long `;`-chained lines split. The tests for `--limit` fail when the guard is removed and assert the `maxResults` sent.
3. **Port, fixture and advice.** The version-not-found marker moves to `ports/tracker.ts`. `issueListLabelled` leaves the port and all adapters. The fixture reads version issues and counts pages through the version-list request. The two TSDoc blocks and the stale test comment state current behaviour. `issue-source.ts` parses the Tracker scheme once, the `sprintOwner` docstring states the drift direction correctly, and a repository with no `Tracker` key gets advice that does not name Jira as sprint owner. `plot-detect-repo.sh` counts a prefix once per branch. `skills/plot-board-setup/SKILL.md` names which rule wins when no `Tracker` key exists and `ticket.prefix` is null. The empty-stdin entry test asserts that `Sprint owner: plot` is absent.

Every slice keeps the layering rule: the shell arms answer a question and the domain port owns the contract. Slice 3 moves the marker to the side that defines it.

### Open Questions

- [ ] Which mechanism does the sibling plan (#2259) choose for the cut-result notice? Slice 2 reads that plan before it writes the replacement.
- [ ] Does any caller outside the repository use `issueListLabelled`? The issue says no production caller exists in this repository.
- [ ] Does the exit-2 code for the above-one-page refusal (`:5002`) stay and get documented in the header, or move to an existing code? Slice 2 picks one and records it in the header.

## Slices

### Issue state

- `feature/tracker-arms-issue-view-state` — Jira and Bitbucket `issue-view` map state from the right field, and host tests assert `state` for all three hosts

### Issue list

- `feature/tracker-arms-issue-list-counted` — `issue-list --fix-version` checks once and counts the request, arguments validate, the cut-result notice changes mechanism <!-- waits: feature/tracker-arms-issue-view-state -->

### Port and advice

- `feature/tracker-arms-port-and-advice` — marker on the port, dead operation removed, doc and advice fixes, one Tracker scheme parse <!-- waits: feature/tracker-arms-issue-list-counted -->

## Notes

- Created from tracker issue #2483 by `/plot-idea`. The issue is the problem statement; the plan answers it in three slices rather than copying the 26 findings one by one.
- Nothing was written to the tracker.
