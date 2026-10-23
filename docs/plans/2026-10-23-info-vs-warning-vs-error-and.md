# Board PR status: info vs warning vs error, and name the real cause

> The board's PR footer prints two informational `plot-host` lines inside a sentence that calls the data unavailable, and omits the cause: an earlier HTTP 429 and a 14-minute backoff. Readers restart the board, which adds another request burst.

## Status

- **State:** Delivered
- **Type:** bug
- **Sprint:** bugfix-2-28-2
- **Issue:** #2387
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2426 merged
- **Started:** 2026-10-23, Jan Wloka, `bug/the-pr-status-has-a-level-and-a-cause`
- **Started:** 2026-10-23, Jan Wloka, `bug/the-board-shows-the-pr-level-and-diagnostics`
- **Delivered:** 2026-10-24

## Changelog

- The board's PR status line shows one of three levels — info, warning, error — names the cause of a stale or missing PR list (throttling, missing credentials) with the time the backoff ends, and moves `plot-host` notices into an expandable diagnostics view.

Board impact: changes the footer wording and adds a diagnostics view in `packages/board`. No change to the plan format, template, helper scripts or `docs/plans` layout.

## Motivation

Seen 2026-10-23 on Plot 2.28.0 with Bitbucket, the footer read:

> PR data unavailable (plot-host: bitbucket ignores --limit 1000; the listing returns one page of 50 per state plot-host: bitbucket pr-list state=open page complete (8 rows below requested limit 1000) — this page holds every pull request the host has in this state) — the two groups above that depend on it may be incomplete.

Both embedded lines are notices. The second says the open list is complete. The failure, an HTTP 429 followed by a 14-minute backoff, is absent from the text. A reader takes the line for an outage and restarts the board, and the restart issues a new burst against a host that is already throttling.

`prNote` in `packages/board/src/app/lib/agent-rows/host-notes.ts` already separates three failures: unreachable host, spent quota, secondary limit. The unreachable-host branch copies `fleet.prError` verbatim into the sentence (`PR data unavailable (${fleet.prError})`), so every notice that `plot-host` appends to the error string lands in the banner. Two earlier plans handled the throttle wording: `a-throttled-host-says-so` (Released 2.13.0) and `a-throttled-host-is-not-a-missing-pr` (Released 2.21.0, #985). This plan covers the rest of the footer.

## Design

### Approach

Issue #2387 proposes three levels, one line each:

| Level | When | Example |
|---|---|---|
| Info (grey) | Data comes from cache younger than the refresh interval | `PRs from 09:41 · next refresh 09:55` |
| Warning (amber) | Cache older than 2× the interval, or known incomplete | `PRs 32 min old — Bitbucket throttling (429), 44 spenders on the account` |
| Error (red) | No data at all, or credentials missing | `Bitbucket refuses: no credentials` |

Four changes follow, in order:

1. **Classify in the domain.** The level, the cause and the backoff end are properties of a domain value, tested without rendering (CLAUDE.md, *Every rendered state is a domain property*). The component prints what the domain returns.
2. **Name the cause.** A 429 and its backoff end (`backoffUntil` from the gate, already in `issues.json` and the PR pass's cadence fields) appear in the banner sentence. A reader sees the end time and has no reason to restart the board.
3. **Move `plot-host` notices out of the sentence.** Lines such as `ignores --limit` and `page complete` go to an expandable diagnostics view under the footer. The banner sentence never embeds them. A notice that reports a complete page is not a failure and does not set the level to error.
4. **Name the spenders.** Replace the bare count (`prSpenders`) with who spends: board port, project and session count, so a reader can close the right one. The record `prSpenders` is read from carries a count today; the plan must establish what identity it can supply before the board promises names.

### Open Questions

- [ ] What identity does the spender record hold today? If it holds only a count, a slice must extend the record before the board can name spenders, and that slice belongs to the writer of the record rather than the board.
- [ ] Where does the notice/failure split live: in `plot-host` (separate output channels) or in the board (parse the error string)? Parsing prose in the board is the weaker option; the error string carries both kinds today.
- [ ] The interval for the 2× rule: the fleet's PR refresh cadence or the board's poll interval? The banner must use the one the data is refreshed on.
- [ ] Does the issues footer (`issueNote`) take the same three levels in this plan, or in a follow-up?
- [ ] Is the Bitbucket-specific `bb`/`plot-host` notice text the only source, or does the GitHub backend emit comparable notices?

## Slices

### Classification

- `bug/the-pr-status-has-a-level-and-a-cause` — domain value for the PR status: level (info, warning, error), cause, backoff end, and the notices split off as diagnostics; unit tests for every row of the table above. → #2437

### Banner

- `bug/the-board-shows-the-pr-level-and-diagnostics` — the footer prints the level and cause line and renders the diagnostics in an expandable view; one browser test proves each level shows. → #2461

## Notes

- Created unattended from issue #2387. The design question was not answered in the prompt, so the plan starts in Draft. The tracker received no write.
