# Board: the ready line waits for every address, and a released desk says why

> The board prints its ready line only after every address it listens on is bound, and a released ended desk keeps its note in a section and names its `Worker bound`.

## Status

- **State:** Released
- **Type:** bug
- **Sprint:** bitbucket-jira-and-jenkins-work-with-the-board
- **Issue:** #1951, #1900, #1916
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1953 merged
- **Started:** 2026-10-17, Jan Wloka, `bug/ready-line-after-every-bind`
- **Started:** 2026-10-17, Jan Wloka, `bug/released-desk-keeps-its-note`
- **Delivered:** 2026-10-18
- **Released:** 2026-10-22, v2.28.0

## Changelog

- Board: the ready line prints after the server binds every address, so a client that connects over `127.0.0.1` on the ready line connects.
- Board: a free desk released from *Waiting on you* shows as an agent row in *Quiet* with the note "ended after <h> h with no slice offered — reaped on the next pass", where <h> is the configured `Worker bound`.

<!-- Board impact: the first slice changes packages/board only. The second changes packages/board and packages/domain (`rules/ended-desk.ts`), and reads the `Worker bound` config key in `buildFleet`; no plan-format, template or helper-script change. -->

## Motivation

Two board defects, answered together by issue #1951.

**#1900 — ready line before the second bind.** `packages/board/src/server/index.ts:1089` prints `Plot board: http://localhost:<port>` in the callback of the first `listen` (`::1`), then binds the remaining addresses through `bindNext` (`:1092`). A client that reads the line and connects over IPv4 in that gap gets `ECONNREFUSED 127.0.0.1`. Measured 2026-10-16 in a Linux container (Ubuntu 24.04, node 24, `--cpus=4`): some runs of the board tests failed with `ECONNREFUSED 127.0.0.1`, at the same rate with and without the fix for #1899. The race has not shown in GitHub CI. `port.test.mjs:247-259` already requests `127.0.0.1` right after the ready line and is the likely flaky test.

**#1916 — a released desk's note renders nowhere.** After #1902 a free desk whose wait ran out leaves *Waiting on you*: exit `124`, the supervisor's `unreadable` ending, merged slice, clean tree. Two parts of the brief for `bug/row-placement-quiet-and-wait-bound` are unmet:

- `endedDeskPlacement` returns the note "ended at the wait bound with no slice offered — reaped on the next pass" (`ended-desk.ts:93`), but `brokenAgentRows` drops every entry with `owesPerson: false` (`working-agents.ts:85`), and `ended` is attached only to broken entries (`ended-desks.ts:35`). No row carries the note.
- `boundSeconds` is always `null` (`ended-desks.ts:47`), because `buildFleet` reads no `Worker bound` config. The note never says "after <h> h".

The browser test sets `ended` by hand (`row-placement-quiet-and-ended-desk.browser.test.ts:88-91`) and proves only that the desk is absent from *Waiting on you*.

## Design

### Approach

**Ready line.** Print the line after the last address binds or fails to bind. `bindNext` ends the chain when `rest` is empty (`index.ts:1066`), so the print moves to that terminal case. A failed extra bind already warns and continues, so the line prints after the warning and the board is not left without one. The line text stays unchanged: tooling that reads it keeps working. The `tailscale:` line still prints after the ready line, and its comment at `index.ts:1093-1099` ("prints first either way") is updated to state the order the new code guarantees.

The bind chain is extracted into a function that takes the listen call as a parameter, so a unit test can hold each bind's callback and release it by hand.

**Released desk.** Three parts:

1. **The bound.** `buildFleet` reads the raw `Worker bound` key through the board's `readConfigAsync` (`fleet.ts:39`) and passes it to `withEndedDesks`, which passes it as `boundSeconds` in place of `null`. `boundSecondsOf` (`packages/fleet/src/shared/fleet-run.ts:69`) is not used: it substitutes 28800 for `0`. A value of `0`, an absent key and any value that is not a positive integer pass `null`, so the note keeps "at the wait bound". `buildFleet` reads the key only when at least one entry's ending reads `freeWaitEnded`; a fleet with no such desk spawns no extra `plot-config.sh` (each read is one uncached `bash` process, measured 0.12 to 0.94 s, and `/api/fleet` is polled every 4 s per viewer).
2. **The section.** The domain decides it (*Every rendered state is a domain property*). `EndedDeskPlacement` gains `section: 'waiting-on-you' | 'quiet'`, using the section keys of `sections.ts`, and `owesPerson` is derived from it in the domain (`section === 'waiting-on-you'`) so the two cannot disagree. A released desk answers `quiet`.
3. **The row.** A registry-sourced agent row in *Quiet*, built from the entry the way `brokenAgentRows` builds *Waiting on you* rows, carries the note. The new row helper is an arrow function. The row is derived on every build from the desk's files and never persisted; it disappears when the reaper removes the desk.

**Known limitation.** The worker loop lets `PLOT_WORKER_BOUND` override the config (`worker-loop.ts:2269`). The board cannot see that variable, so the note names the repository's configured bound, which can differ from the bound the desk ran under.

### Decisions

- [x] **Section for a released ended desk: Quiet**, as an agent row. Decided from the panel of 2026-10-17 (`.plot/panels/the-ready-line-waits-for-every/panel.md`), 3 of 4 jurors; see Notes to overturn it. A free desk can carry `branch: ''` and join no branch row, so a note on a branch row can render nowhere again; the desk is an Agent fact, not a branch fact; *Done* means delivered, a plan transition the desk has not made.
- [x] **Note lifetime: for as long as the desk exists.** The note is derived on every build and never stored, so the reaper's removal of the desk ends it. Both readings of the original question are this one behaviour.
- [x] **`Worker bound` of `0`: `boundSeconds` is `null`.** ROW 2 fires only for a bound above 0 (`agent-loop.ts:478`), so "after 0 h" would be false. Absent and unparseable values are `null` too.

## Slices

### Ready line

- `bug/ready-line-after-every-bind` — print the ready line after every address binds or fails to bind. Done when: a unit test drives the extracted bind chain with an injected listen, releases the callbacks by hand, and asserts the ready line prints only after the last bind settles, and the test goes red when the print is moved back to the first callback; `port.test.mjs` keeps its contract that every loopback family the board did not warn about answers a request issued on the ready line, reusing the describe's existing server; under `HOST` the `tailscale:` line still follows the ready line. No new board-server test. <!-- builds: extracted bind chain with injected listen, a unit test of ready-line order --> → #1964

### Released desk

- `bug/released-desk-keeps-its-note` — read `Worker bound` in `buildFleet` when a desk reads `freeWaitEnded`, add `section` to `EndedDeskPlacement`, and place a released ended desk as an agent row in *Quiet* with its note. Done when: a domain unit test on `endedDeskPlacement` asserts `section` for each reading and the "after 8 h" wording for a bound of 28800 and the "at the wait bound" wording for `0` and `null`; a `withEndedDesks` unit test in `test/unit/ended-desks.test.ts` with the fake `read` proves the bound arrives; the catalogue browser test builds its `ended` by calling `withEndedDesks` over desk-file fixtures, not by hand, and asserts the note in *Quiet*. No new board-server test. <!-- builds: released-desk Quiet agent row, a domain section answer for ended desks --> → #2000

## Notes

- Source: issue #1951 (https://github.com/plot-pm/plot/issues/1951), members #1900 and #1916. Written with `/plot-idea` unattended; the plan stops at Draft.
- Deliverable search for `endedDeskPlacement` found it in `packages/domain/src/rules/ended-desk.ts` and `packages/board/src/server/ended-desks.ts`. This plan extends both and builds no duplicate.
- Both slices touch disjoint files and can run concurrently.
- Round 1 was a four-lens panel (estate, contradiction, deliverable, cost), unanimous amend: `.plot/panels/the-ready-line-waits-for-every/panel.md`.
- **Operator may overturn:** the *Quiet* section is a decision taken from the panel, not from a person. #1916 left it open.
- Disagreement, section: estate chose *Done* on the slice's merged branch row, citing `fleet.ts:4061-4064` ("Merged work is DONE, not quiet"); contradiction, deliverable and cost chose *Quiet* as an agent row.
- Disagreement, slice 1 test: deliverable and contradiction chose an injected-listen seam; cost chose holding `127.0.0.1:<P>` and asserting the `could not also bind` warning precedes the ready line. The seam is the done-when; the occupied-port test is an acceptable addition.
- Disagreement, absent `Worker bound`: deliverable chose 28800, the loop's default; estate, contradiction and cost chose `null`, since the board cannot see the desk's effective bound.
- Disagreement, slice 2 browser test: deliverable asked for a desk built through a fleet fixture; cost and estate asked for no new board server. The catalogue test with `ended` from `withEndedDesks` satisfies the "no hand-set `ended`" request without a server.
- Panel blind spot: no juror ran the code. The implementing slice reverts the print move once and shows the new test fail before it is trusted.
