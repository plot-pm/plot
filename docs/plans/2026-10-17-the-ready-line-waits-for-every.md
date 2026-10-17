# Board: the ready line waits for every address, and a released desk says why

> The board prints its ready line only after every address it listens on is bound, and a released ended desk keeps its note in a section and names its `Worker bound`.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #1951, #1900, #1916
- **Review:** pr
- **Impl:** own branches

## Changelog

- Board: the ready line prints after the server binds every address, so a client that connects over `127.0.0.1` on the ready line connects.
- Board: a free desk released from *Waiting on you* keeps its row, shows the note "ended after <h> h with no slice offered", and names the configured `Worker bound`.

<!-- Board impact: both slices change packages/board only. The second reads the `Worker bound` config key in `buildFleet`; no plan-format, template or helper-script change. -->

## Motivation

Two board defects, answered together by issue #1951.

**#1900 — ready line before the second bind.** `packages/board/src/server/index.ts` prints `Plot board: http://localhost:<port>` in the callback of the first `listen` (`::1`), then binds the remaining addresses through `bindNext`. A client that reads the line and connects over IPv4 in that gap gets `ECONNREFUSED 127.0.0.1`. Measured 2026-10-16 in a Linux container (Ubuntu 24.04, node 24, `--cpus=4`): some runs of the board tests failed with `ECONNREFUSED 127.0.0.1`, at the same rate with and without the fix for #1899. The race has not shown in GitHub CI.

**#1916 — a released desk's note renders nowhere.** After #1902 a free desk whose wait ran out leaves *Waiting on you*: exit `124`, the supervisor's `unreadable` ending, merged slice, clean tree. Two parts of the brief for `bug/row-placement-quiet-and-wait-bound` are unmet:

- `endedDeskPlacement` returns the note "ended at the wait bound with no slice offered", but `brokenAgentRows` drops every entry with `owesPerson: false`, and `ended` is attached only to broken entries (`packages/board/src/server/ended-desks.ts`). No row carries the note.
- `boundSeconds` is always `null` (`ended-desks.ts`), because `buildFleet` reads no `Worker bound` config. The note never says "after <h> h".

The browser test sets `ended` by hand and proves only that the desk is absent from *Waiting on you*.

## Design

### Approach

**Ready line.** Print the line after the last address binds or fails to bind. `bindNext` ends the chain when `rest` is empty, so the print moves to that terminal case. A failed extra bind already warns and continues, so the line prints after the warning and the board is not left without one. The line text stays unchanged: tooling that reads it keeps working.

**Released desk.** Two parts:

1. `buildFleet` reads `Worker bound` through the config reader and passes it to `withEndedDesks`, which passes it as `boundSeconds` in place of `null`. Domain `endedDeskPlacement` already words the bound.
2. The row that carries the note needs a section. The domain decides it (*Every rendered state is a domain property*), so the placement answer gains the section and the component only renders it.

### Open Questions

- [ ] Which section holds a released ended desk's row? Candidates: a quiet section beside other desks that wait to be reaped, or the desk's own plan or branch row carrying the note as a badge. The issue says this is not decided. A person chooses before the second slice is briefed.
- [ ] Does the note stay for as long as the desk exists (the original brief) or until the reaper removes it? The reaper's next pass bounds "as long as the desk exists" in practice.
- [ ] `Worker bound` of `0` disables the floor (`agent-loop.ts`). Should `boundSeconds` be `null` for `0`, so the note keeps the "at the wait bound" wording?

## Slices

### Ready line

- `bug/ready-line-after-every-bind` — print the ready line after every address is bound; a test connects over `127.0.0.1` on the line and expects success <!-- builds: ready-line-after-every-bind test, a board server test that connects over 127.0.0.1 when the ready line appears -->

### Released desk

- `bug/released-desk-keeps-its-note` — read `Worker bound` in `buildFleet`, place a released ended desk in the chosen section with its note, and replace the hand-set `ended` in the browser test with a fleet reading <!-- builds: released-desk section, a domain placement answer for ended desks that owe nobody -->

## Notes

- Source: issue #1951 (https://github.com/plot-pm/plot/issues/1951), members #1900 and #1916. Written with `/plot-idea` unattended; the plan stops at Draft.
- Deliverable search for `endedDeskPlacement` found it in `packages/domain/src/rules/ended-desk.ts` and `packages/board/src/server/ended-desks.ts`. This plan extends both and builds no duplicate.
- Both slices touch disjoint files and can run concurrently.
