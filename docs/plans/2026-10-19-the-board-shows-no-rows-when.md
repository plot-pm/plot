# The board shows no rows when /api/board takes longer than the 3.5 s poll limit

> A board that answers slowly shows `Failed to load board: Fetch is aborted` and no rows, because the client aborts every poll before the answer arrives.

## Status

- **State:** Released
- **Type:** bug
- **Approved:** 2026-10-19, Jan Wloka, plan-PR #2087 merged
- **Started:** 2026-10-19, Jan Wloka, `bug/the-board-shows-no-rows-when`
- **Delivered:** 2026-10-19
- **Released:** 2026-10-22, v2.28.0
- **Sprint:** <!-- optional, filled when plan is added to a sprint -->
- **Issue:** #2083
- **Story:** <!-- optional, story slug this plan is part of (docs/stories/<slug>/) -->
- **Review:** pr
- **Impl:** own branches

## Changelog

- The board keeps showing rows when `/api/board` answers slower than the poll limit, and a slow answer no longer reads as an unreachable server.

<!-- Board impact: changes the board's client poll (`packages/board/src/app/App.tsx`), and possibly the `/api/board` handler. No change to the plan format, the template, the helper scripts or the docs/plans layout. Rebuild the board artifact (pnpm build:board) to test locally; do not commit it. -->

## Motivation

### Measured 2026-10-19 (issue #2083)

At 09:58 the board at `http://localhost:7777/?show=tickets` showed `Failed to load board: Fetch is aborted` and no rows.

- `/api/board` answered `200` in 4.38 s, 4.55 s and 4.59 s over three runs. `/api/board?show=tickets` answered in 4.91 s. The machine's load average was 11.2.
- The client bounds every poll with `AbortSignal.timeout(POLL_TIMEOUT_MS)` (`packages/board/src/app/App.tsx:330`). `POLL_TIMEOUT_MS` is `3_500` (`App.tsx:113`, set in #480 on 2026-08-27).
- Each poll aborts before the answer arrives, and the next poll aborts the same way. The server answers every request, and the board never shows rows while the server needs more than 3.5 s.

### Why the limit is 3.5 s

The comment above `POLL_TIMEOUT_MS` gives two reasons. A poll killed mid-response by a `node --watch` restart never rejects, so without a bound nothing counts the failure and the "server is gone" overlay stays silent. A request still outstanding when its successor fires can land out of order and show older data. The fix has to keep both properties: a dead server is still counted, and at most one board request is live at a time.

The limit was derived for the fleet's 4 s poll. `/api/board` polls every 30 s (the `DIM_AFTER_FAILURES` comment), so the board request has 26 s of slack the fleet request lacks.

## Design

### Approach

The issue names three options. This plan does not pick one; the Open Questions below decide.

1. **A longer bound for `/api/board`.** The first load and each board poll use a limit above the server's measured answer time. The fleet poll keeps 3.5 s. The 30 s board cadence allows a limit well above 4.9 s without two board requests overlapping.
2. **Keep the last board on screen, mark it stale.** A failed poll leaves the previous rows in place and shows a stale marker. This covers any slow answer, and the first load still needs a bound.
3. **Serve the last computed payload.** `/api/board` answers from its last computed payload while it computes the next. This removes the slow answer instead of tolerating it, and puts a cache in the server.

Whichever option is chosen, the fix records `/api/board`'s answer time before and after, on a loaded machine, as the issue asks. A reading at load average 11 is the baseline; the reading says which of the three options the 4.4–4.9 s answer time needs.

Board impact: `packages/board/src/app/App.tsx` for options 1 and 2; the `/api/board` handler for option 3. Rendered states belong to the domain (CLAUDE.md, *Every rendered state is a domain property*), so a stale marker's wording and visibility are a domain property with a unit test, plus one browser test proving the marker shows.

### Open Questions

- [ ] Which option, or which combination? Option 1 alone fixes the measured case and leaves a board answering in 31 s blank. Option 2 degrades gracefully for any answer time.
- [ ] Does `/api/board` need 4.4 s under load at all? Where does the time go (the git scan, the host calls, the plan parse)? A measurement of the mechanism may remove the need for any client change.
- [ ] If the limit rises, what keeps "at most one board request live"? The poll must skip a tick while a request is outstanding, or the limit must stay below the 30 s cadence.
- [ ] Does the same limit hit `/api/fleet` (`App.tsx:371`) at the 4 s cadence under the same load?

## Slices

### Slow answer shown

- `bug/the-board-shows-no-rows-when` — the board poll shows a slow `/api/board` answer, with before and after answer times recorded in the PR → #2093

## Notes

- Source: tracker issue #2083, <https://github.com/plot-pm/plot/issues/2083>. The plan's `Issue:` field is the only link; nothing was written to the tracker.
- Related: [a-dead-fetch-is-not-a-slow-one](2026-08-26-a-dead-fetch-is-not-a-slow-one.md) added the poll bound this plan revisits.
