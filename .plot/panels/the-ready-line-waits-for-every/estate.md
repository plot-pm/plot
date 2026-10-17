# Estate lens — the-ready-line-waits-for-every

Position: amend

The diagnosis is correct and both slices extend existing code. They do not duplicate it. Four amendments bring the plan into line with code the estate already has: one test contract, one section, one config reader, and the scope of the second slice.

## 1. Motivation claims against the code

- **#1900 holds.** `packages/board/src/server/index.ts:1089` prints `Plot board: http://localhost:<port>` inside the first `listen` callback (`::1` when `HOST` is unset, `:1053`). `bindNext(BIND_ADDRESSES.slice(1))` runs only after the print (`:1092`). `bindNext` returns when `rest` is empty (`:1066`), and a failed extra bind warns and recurses (`:1068-1073`). The approach matches this structure.
- **#1916, note dropped: holds.** `ended-desks.ts:35` attaches `ended` only when `isBrokenState(agent.state)`. `working-agents.ts:85` filters out `ended?.owesPerson === false`. No other consumer renders `ended.note`.
- **#1916, bound null: holds.** `ended-desks.ts:47` sets `boundSeconds: null`. `fleet.ts:7153` calls `withEndedDesks(entry.agents, placedRows)` with no bound.
- **Browser test: holds.** `row-placement-quiet-and-ended-desk.browser.test.ts:88-91` sets `ended` by hand and asserts only absence.
- **Small inaccuracy.** The Changelog note reads "ended after <h> h with no slice offered". The domain appends "— reaped on the next pass" (`ended-desk.ts:93`). The Changelog should quote the full text, or the slice changes the wording on purpose and says so.

## 2. Slice buildability and "done"

- **`bug/ready-line-after-every-bind`.** Buildable. "Done" is a test, but as written the test contradicts an existing contract. `port.test.mjs:211-245` deliberately tolerates a failed IPv4 bind, because a GitHub Linux runner could not bind IPv4 on 2026-09-13 and the board correctly served `::1` only. A test that "connects over 127.0.0.1 on the line and expects success" fails that runner on a board behaving as designed. Two estate facts follow:
  - The race is already in the suite. `port.test.mjs:247-259` ("binds both families on the SAME port under PORT=0") asserts IPv4 `200` unconditionally, right after `startServer` saw the ready line. This is very likely the flaky `ECONNREFUSED 127.0.0.1` from the container measurement. The new test belongs in `port.test.mjs`, beside these two tests, and does not need a new harness.
  - `HOST=0.0.0.0` path: `BIND_ADDRESSES` has one entry, so `bindNext([])` returns at once. The print in the terminal case stays synchronous and still precedes the `tailscale:` line (`:1093+`). The slice must keep that order, because `announces()` (`:126`) and `helpers.mjs` read both lines.
- **`bug/released-desk-keeps-its-note`.** Buildable once a section is chosen (§3), but three statements are wrong or missing:
  - The Board-impact comment says "both slices change packages/board only". The Approach says "the placement answer gains the section", which is `packages/domain/src/rules/ended-desk.ts`. The domain changes too, and its arrow and TSDoc rules apply.
  - "Done" names no unit test. A browser test is where the result is *seen* (CLAUDE.md, *Every rendered state is a domain property*). The decision needs a domain unit test on `endedDeskPlacement` that asserts the section and the bound wording.
  - The test path is unnamed: "a fleet reading" in place of the hand-set `ended`. It should name the existing harness that feeds a fleet payload to the browser test, or say that `withEndedDesks` gets a unit test with a fake `read` (its third parameter already exists for this, `ended-desks.ts:31`).

## 3. Open question 1: section — recommend DONE, on the joined branch row

- **QUIET contradicts code.** `fleet.ts:4061-4064`: *"Merged work is DONE, not quiet … putting it in `quiet` was the first thing that looked wrong on screen."* `endedDeskPlacement` releases a desk only when `merged === true` (`ended-desk.ts:85`). By construction every released desk's slice row already sits in `{ group: 'done', note: 'merged' }` (`fleet.ts:4068-4070`). A QUIET row would show the same slice in two sections, and one of them is a section the estate has already rejected for merged work.
- **A new "awaiting reaping" section has no estate precedent.** `WaitingGroupSchema` (`schema.ts:2040-2047`) holds six groups. Reaping is already announced in the note text ("reaped on the next pass"), so a seventh group adds a word nobody needs.
- **DONE with the note on the row** reuses the join `withEndedDesks` already makes (`byBranch` by branch or checkout, `ended-desks.ts:33,38`) and the existing `note` slot. For the placement answer, use the shape the estate already has: `draft-placement.ts:28-29` returns `{ group, note }` as a discriminated union. `EndedDeskPlacement` can gain `group: 'done'` for the released case and keep `owesPerson` or derive it.
- **One edge to state.** When the desk's branch joins no row (an `elsewhere` row or no row), `merged` is `null` and the desk is never released (`ended-desk.ts:85`). DONE therefore always has a row to carry the note.

## 4. Open questions 2 and 3

- **Q2, lifetime: as long as the desk exists, and nothing more.** The note is derived on each `buildFleet` from desk files (`readDeskFile`). It disappears when the reaper removes the desk, so the two candidate answers are one answer. The board must not persist it: *Answers, never verdicts* (CLAUDE.md; `fleet.ts:2173`). Close Q2 with that sentence.
- **Q3, `Worker bound` of 0: pass `null`.** `agent-loop.ts:477` fires ROW 2 only when `boundSeconds > 0`, so with a bound of 0 a free-wait exit 124 cannot happen, and naming "after 0 h" would state a falsehood. Pass `null` for 0, absent, and unparseable values. "At the wait bound" stays the fallback wording.
  - Do not reuse `boundSecondsOf` (`packages/fleet/src/shared/fleet-run.ts:69`). It maps 0 to its default (28800), and the loop treats 0 as disabled. Read with the board's own `readConfigAsync` (already imported at `fleet.ts:39`) and map non-positive values to `null`.
  - Known blind spot: `worker-loop.ts:2269` lets `PLOT_WORKER_BOUND` override the config. The board cannot see that environment variable, so the named hours can differ from the bound the loop used. State this in the slice; do not try to fix it.

## 5. Amendments

1. Board-impact comment: replace "both slices change packages/board only" with "the first slice changes packages/board; the second changes packages/board and packages/domain (`rules/ended-desk.ts`)".
2. Ready-line slice: replace "a test connects over `127.0.0.1` on the line and expects success" with "in `packages/board/test/port.test.mjs`, a test reads the ready line and then gets 200 from every loopback family the board did not warn about; the existing 'SAME port under PORT=0' test passes without retries; under `HOST` the `tailscale:` line still follows the ready line".
3. Close open question 1 as "DONE: the note rides the slice's merged row, which `fleet.ts:4068` already places in `done`", and add `group: 'done'` to `EndedDeskPlacement` in the shape of `draft-placement.ts`.
4. Close open question 2 as "for as long as the desk exists; derived each build, never persisted".
5. Close open question 3 as "`null` for 0, absent or unparseable; read through `readConfigAsync`, not `boundSecondsOf`, which maps 0 to 28800".
6. Released-desk slice "done": add "a domain unit test on `endedDeskPlacement` asserts the group and the 'after 8 h' wording; a `withEndedDesks` unit test with a fake `read` proves the bound arrives; the browser test asserts the note on the DONE row".
7. Changelog: quote the note in full ("… — reaped on the next pass"), or state the wording change.
