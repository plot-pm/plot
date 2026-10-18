# Bitbucket + Jenkins: pr-list binds a PR row's checks to its own head

> Under `CI: jenkins` on Bitbucket, `plot-host.sh pr-list` takes each row's `checks` from the branch colour and emits no `checksSha`, so a pushed head keeps the previous head's `green` until Jenkins builds it.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:**
- **Issue:** #2053
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-18, Jan Wloka, plan-PR #2056 merged
- **Started:** 2026-10-18, Jan Wloka, `bug/bitbucket-jenkins-pr-list-binds-a`

## Changelog

- `plot-host.sh pr-list --rich` on Bitbucket with `CI: jenkins` binds each row's `checks` to the PR's own head commit and emits `checksSha`. A branch colour that cannot bind to the head reads `unknown`.

Board impact: the board and the merge queue read `checks` and `checksSha` from `pr-list`. They stop reading a stale `green` for an unbuilt head. No plan-format change, no rebuild of the board artifact expected.

## Motivation

The Bitbucket arm of `pr-list --rich` (`plot-host.sh:4357-4393`) reads `checks` from `$jmap[.source.branch.name]`, the Jenkins branch colour, and emits no `checksSha`. After a push the row keeps the previous head's `green` until Jenkins builds the new head. The board and the merge queue then read `green` for a commit nobody built.

The GitHub arm already binds each row to its head: the `_sha_map` overlay (`plot-host.sh:4214-4218`, #1959) names the rows `jmap` cannot settle through `rowsToBind`, reads their builds by sha through `jenkins_sha_runs`, and binds them through `bindChecks`. The Bitbucket arm was left out, although the changeset of #1959 claims both. Review #1966 found it. #1848 and #1867 track it.

## Design

### Approach

The Bitbucket arm gets the same overlay as the GitHub arm.

- Feed `rowsToBind` the Bitbucket rows with head `.source.commit.hash`, and bind through `bindChecks`, as the GitHub arm does (`board/plot-jenkins-pr-checks.mjs rows` / `bind`).
- Emit `checksSha` on each Bitbucket row from the bound reading, and `""` where nothing bound.
- Match by prefix. Bitbucket gives a 12-character short hash and Jenkins records the full 40-character SHA1. Reuse the prefix rule PR #1974 adopts for `pr-state`; do not add a second one. This plan depends on #1974 merging first.
- A colour that cannot bind to the head reads `unknown`, never `pending` (decided 2026-10-17 for gap 3 of #1867).
- Host tests use real-shaped values: a 12-character Bitbucket hash and a 40-character Jenkins SHA1.

### Open Questions

- [ ] Does `rowsToBind` / `bindChecks` take the short hash as is once #1974 lands, or does the bundle need the prefix rule passed in? Read #1974 before the slice starts.
- [ ] Does `SHA_LOOKUPS_PER_PASS` bound the Bitbucket arm the same way as the GitHub arm, or does Bitbucket's pagination change the per-pass cost?

## Slices

### Bitbucket binding

- `bug/bitbucket-jenkins-pr-list-binds-a` — bind the Bitbucket Jenkins arm of `pr-list --rich` to each PR's head and emit `checksSha`, with host tests on a 12-character hash and a 40-character SHA1 <!-- builds: Bitbucket sha-bound overlay in plot-host.sh pr-list, mirroring the GitHub _sha_map overlay --> <!-- waits: PR #1974 -->

## Notes

- Source: tracker issue #2053. Related: #1959 (GitHub arm), #1966 (review that found the gap), #1848, #1867, #1974 (prefix rule).
