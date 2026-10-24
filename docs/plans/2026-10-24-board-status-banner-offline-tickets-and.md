# Board status banner, offline tickets and board builds show stale or wrong state

> Thirty-one follow-up findings from plot-review show the board's status banner, offline ticket fallback and shared board build reporting stale or wrong state.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** follow-ups-2-28-3
- **Issue:** #2477
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2498 merged
- **Started:** 2026-10-24, Jan Wloka, `bug/board-status-banner-states`
- **Started:** 2026-10-24, Jan Wloka, `bug/board-build-joins-honour-opts`
- **Started:** 2026-10-24, Jan Wloka, `bug/board-estate-runs-once-per-head`
- **Started:** 2026-10-24, Jan Wloka, `bug/board-client-fetch-bound-and-click`

## Changelog

- Board: the PR status banner shows the backoff end for every refusal kind, reads error for missing credentials, and names the whole credential notice.
- Board: the offline ticket fallback shows an age only beside rows, and a failed poll clears both.
- Board: a joined board build uses its caller's options and starts after the triggering change, and a failed shared build rejects every joined caller.
- Board: the plan-estate walk and the dirty-checkout check run once per head change, take no index lock and ignore untracked files.
- Board: the board fetch bound fits the 4 s poll, and a plan click on an unreachable board answers at once.

Board impact: changes `packages/board` and `packages/domain` behaviour. No change to the plan format, the template or the helper scripts.

## Motivation

Issue #2477 collects 12 MEDIUM and 19 LOW findings that plot-review raised on ten merged PRs (#2088, #2097, #2113, #2318, #2372, #2384, #2441, #2450, #2453, #2463) and checked against `origin/main` at `84b1638e4` on 2026-10-24. Each finding is small. Together they leave the board's status banner, its offline ticket rows and its build path showing a state that differs from the host, the plan table or the repository.

## Design

### Approach

The findings fall into five groups, one per slice. Each slice fixes the MEDIUM findings of its group and the LOW findings (comments, test titles, redundant guards) that sit on the same lines.

1. **PR status** (#2441, #2463): `packages/domain/src/rules/pr-status.ts` sets `backoffInSeconds` for every refusal kind, `prStatusLevel` returns `error` for missing credentials when data is on screen, and the credential-notice pattern matches the whole sentence for every source, `BITBUCKET_REVIEW_USER` included. `host-notes.ts:446` stops saying the host reported no failure while `hostAnswer` reports unreachable. The `prIntervalMs never varies` comments in `host-notes.ts`, `fleet.ts` and `schema.ts` describe `scheduleNextPr`.
2. **Offline tickets** (#2384, #2372): `offlineIssueRowsInto` sets `issueAt` after `ticketPlansOf` and only when it renders rows. A failed poll clears `issueAt` and the earlier index rows together. `issue-offline-fallback.ts` types the missing age and the own source explicitly rather than as `''` and `string`. The `entry.waiting` doc comment, the two test titles and `CLAUDE.md:515` match the code.
3. **Shared board build** (#2097): `fleet-state.ts` keys the shared build on its opts, and a joiner that arrived after a change triggers a fresh build. A failed build rejects every joined caller, and the next request builds again. The coalescing test asserts these cases and drops the reference-equality comment.
4. **Estate cost** (#2318, #2450, #2453): `isClean` runs `git status --no-optional-locks` and ignores untracked files. `planEstate` and `planAuthors` run once per head change. The redundant `localOnlyPaths` guard goes, tests pin ancestry `yes` and each part of the #2450 fix, and the extra `rev-parse` and ancestry calls get a measurement before any further change.
5. **Board client** (#2088, #2113): the fetch bound in `App.tsx` fits the 4 s starting poll and its comment says so. A remembered plan click on an unreachable board gives feedback at once. A sprint member with no card maps through `planFileFromFleet`. `planLinkClick` returns a value that needs no `card as Card` cast, and a browser test covers a remembered click whose board lands without the card. The `plan-link-click` test header describes the mechanism, and its route callbacks stay synchronous with no real 30 s wait.

The slices touch disjoint files except `fleet.ts` (slices 1 and 2). Slice 2 therefore waits for slice 1.

### Open Questions

- [ ] Does the 12 s fetch bound become 4 s, or does the request carry its own bound per trigger?
- [ ] Does the `planEstate` once-per-head cache live in the board server or behind the `trees` port in the domain?
- [ ] Does the extra `rev-parse` and ancestry cost from #2450 justify a cache after measurement, or does the finding close as measured?

## Slices

### PR status

- `bug/board-status-banner-states` — PR status rule, notice pattern and host-notes wording (#2441, #2463) → #2550

### Offline tickets

- `bug/board-offline-tickets-age-and-rows` — issue age, failed-poll clearing and typed fallback, plus the CLAUDE.md and comment corrections (#2384, #2372) → #2610 <!-- waits: bug/board-status-banner-states -->

### Shared build

- `bug/board-build-joins-honour-opts` — opts-keyed shared build, post-change start and failed-build rejection (#2097) → #2615

### Estate cost

- `bug/board-estate-runs-once-per-head` — `--no-optional-locks`, no untracked files, once-per-head plan estate and pinned ancestry tests (#2318, #2450, #2453) → #2626

### Board client

- `bug/board-client-fetch-bound-and-click` — fetch bound, immediate feedback on an unreachable board and click tests (#2088, #2113)

## Notes

- Created from issue #2477 by `/plot-idea` on 2026-10-24. The plan stops at Draft; whether to do this work is the reader's decision.
- Line numbers in the issue come from `84b1638e4` and can shift. Each slice re-reads its findings against `main` before editing.
