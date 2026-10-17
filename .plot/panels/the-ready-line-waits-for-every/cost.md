# Cost juror: the-ready-line-waits-for-every

Position: amend

The plan is sound and cheap at its core. Slice 1 adds no runtime cost. Slice 2 as written adds one `bash plot-config.sh` spawn to every `/api/fleet` render and, read literally, an extra full board server in the browser tier. Both costs go away with small edits.

## 1. Motivation claims against the code

- True: the ready line prints in the first `listen` callback, before `bindNext` (`packages/board/src/server/index.ts:1084-1092`). The chain ends at `index.ts:1066` (`if (address === undefined) return;`). A failed extra bind warns and continues (`index.ts:1068-1074`).
- True: `withEndedDesks` attaches `ended` only to `isBrokenState` entries (`packages/board/src/server/ended-desks.ts:35`) and passes `boundSeconds: null` (`ended-desks.ts:47`). `brokenAgentRows` drops `ended.owesPerson === false` (`packages/board/src/app/lib/agent-rows/working-agents.ts:85`). No other consumer renders `ended.note`.
- True: `buildFleet` reads no `Worker bound`. Its only config read is `Workflow phases` (`packages/board/src/server/fleet.ts:6983`). The call is at `fleet.ts:7153`.
- True: the browser test hand-sets `ended` (`packages/board/test/integration/row-placement-quiet-and-ended-desk.browser.test.ts:91`). It renders from the static catalogue, not from a board server (`:20`, `:35-38`).
- Not stated: the note text is "ended at the wait bound with no slice offered — reaped on the next pass" (`packages/domain/src/rules/ended-desk.ts:93`). The plan's Changelog drops the suffix.

## 2. Slices: cost and buildability

**`bug/ready-line-after-every-bind`.**
- Runtime: the same binds as today and zero new processes, ports or host calls. Startup latency grows by one extra `listen`, which takes milliseconds.
- Side effect: under `HOST=0.0.0.0` the `tailscale:` line is printed from the first callback (`index.ts:1093-1109`). Its comment says the loopback URL "prints first either way". After the move, that order is no longer guaranteed. `BIND_ADDRESSES` has one element under `HOST` (`index.ts:993`), so the terminal case runs at once and the order holds in practice. The comment still needs an edit.
- Test cost: as written, "a board server test that connects over 127.0.0.1" risks one more `startServer`. The repo already has one:
  - `packages/board/test/port.test.mjs:192-261` starts a server in `before` and requests `127.0.0.1`.
  - `startServer` resolves on the ready-line regex (`packages/board/test/helpers.mjs:244`), so the first request after `before` is exactly the race.
  - That request is probabilistic, and the plan says the race never showed in GitHub CI. For a deterministic check, pre-occupy `127.0.0.1:<P>` with a `net` server, start the board on `PORT=<P>`, and assert that the `could not also bind` warning comes before `Plot board:` on stdout. That costs one server and has no timing dependence.
  - The test must keep port.test's existing contract: every family the board bound answers. "Expects success" on `127.0.0.1` fails a runner that cannot bind IPv4 (`port.test.mjs:222-229`, measured 2026-09-13).
- Done: defined by the test, but the test as worded is not deterministic.

**`bug/released-desk-keeps-its-note`.**
- Runtime: `readConfigAsync` spawns `bash plot-config.sh` per call (`packages/fleet/src/shared/config-reader.ts:35-46`, no cache). Measured here: 0.12, 0.21 and 0.94 s for `get "Worker bound"`.
- `buildFleet` runs per `/api/fleet`, which each viewer polls every 4 s (`packages/board/src/app/App.tsx:39`). Added to the existing `Promise.all`, the read adds no serial latency. It does add about 15 bash spawns per minute per open board, permanently, for a value that matters only when a desk has `freeWaitEnded`.
- Gh/bb calls: none added. Ports: none.
- Test cost: "replace the hand-set `ended` in the browser test with a fleet reading" reads as a real board server over a git fixture with desk files. That is the 42-of-43 pattern CLAUDE.md names. The reading path is already unit-tested with real desk files and no server (`packages/board/test/unit/ended-desks.test.ts:1-11` imports `withEndedDesks` and `brokenAgentRows`). The browser test should stay on the catalogue and assert only that the note is seen in the chosen section.
- Done: "place … in the chosen section" is not buildable until open question 1 is answered. The plan says so.

## 3. Open question 1: section

Recommend **Quiet** (`packages/board/src/app/lib/agent-rows/sections.ts:44`, "still thinking, or dead?"). Add the row as a registry-sourced row, the same way `brokenAgentRows` feeds Waiting on you.
- It is the existing home for "nobody owes anything, still on the floor". Its `quietKind` already includes `merged` (`packages/board/src/contract/schema.ts:3278`), the same condition `withEndedDesks` reads (`ended-desks.ts:43`).
- A badge on the plan/branch row fails for free desks. A free desk's entry can carry `branch: ''` and join by `checkout`, or join no row at all (`ended-desks.ts:38`). The note would then have nowhere to render, which is the defect again.
- Cost: one more filter over `agents` per render. No new reads, no new section, no new catalogue scenario beyond one agent entry.
- Done is not a fit: it means "delivered" (`sections.ts:48`). Working takes only `isLiveState` entries.

## 4. Open questions 2 and 3

- **Lifetime.** Let the note last as long as the desk does. The row is derived each render from the desk's files and needs no state. The reaper ends both in the same pass, so the two options in the question are one behaviour. Write that down and close the question; persisting a lifetime would cost a store and a writer.
- **`Worker bound` of 0.** Map `0`, absent and unparseable values to `null`, which gives the "at the wait bound" wording. Under `0`, ROW 2 never fires (`packages/domain/src/workflows/agent-loop.ts:478`), so `hours(0)` → "after 0 h" would be false. Also note that the worker honours `PLOT_WORKER_BOUND` before config (`packages/fleet/src/server/entry/worker-loop.ts:2269`), so the configured value is the value the desk ran under only when no env override was set. Name this in the plan rather than claim the note states the desk's own bound.

## 5. Amendments

1. Slice 1 comment: replace "a test connects over `127.0.0.1` on the line and expects success" with "in `port.test.mjs`, with `127.0.0.1:<P>` held by a `net` server and the board started on `PORT=<P>`, the `could not also bind` warning precedes `Plot board:`; with no conflict, every family the board bound answers a request issued on the ready line, reusing the describe's existing server".
2. Approach, Ready line: add "the `tailscale:` line's comment at `index.ts:1093-1099` is updated, or that line moves with the ready line".
3. Approach, Released desk, part 1: replace "`buildFleet` reads `Worker bound` through the config reader" with "`buildFleet` reads `Worker bound` only when at least one entry's ending reads `freeWaitEnded`; a fleet with no such desk spawns no extra `plot-config.sh`. `0` and unreadable values pass `null`".
4. Slice 2: replace "replace the hand-set `ended` in the browser test with a fleet reading" with "prove the reading (desk files + bound → placement) in `test/unit/ended-desks.test.ts`; the catalogue browser test asserts that the note renders in the chosen section. No new board-server test".
5. Open questions: settle Q1 as Quiet with a registry-sourced row, Q2 as "for the desk's lifetime, derived per render", and Q3 as "`0` → `null`".
6. Changelog line 2: quote the full note text, including "— reaped on the next pass".
