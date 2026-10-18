# Deliverable lens: the-ready-line-waits-for-every

Position: amend

## 1. Motivation claims against the code

- **#1900, true.** `packages/board/src/server/index.ts:1084-1092`: the first `server.listen(REQUESTED_PORT, BIND_ADDRESSES[0], …)` prints `Plot board: http://localhost:${boundPort}` at :1089, then calls `bindNext(BIND_ADDRESSES.slice(1))` at :1092. `BIND_ADDRESSES` is `['::1', '127.0.0.1']` unless `HOST` is set (:993). `bindNext` ends with `if (address === undefined) return;` at :1066, so that terminal case is the place the plan names. The error path (:1068-1074) warns and recurses, so a print in the terminal case also runs after a failed extra bind. The container measurement cannot be checked from the tree.
- **#1916 note dropped, true.** `working-agents.ts:85` filters `agent.ended?.owesPerson !== false`; `ended-desks.ts:35` returns any non-broken entry unchanged, so `ended` exists only on broken entries. `rows.tsx:2505` would print `agent.ended.note`, but no row reaches it.
- **`boundSeconds` always null, true.** `ended-desks.ts:47` passes `boundSeconds: null`; `fleet.ts:7153` calls `withEndedDesks(entry.agents, placedRows)` with no bound. `buildFleet` (fleet.ts:6932) reads other keys through `readConfigAsync` (:6983) and never reads `Worker bound`.
- **Browser test, true.** `row-placement-quiet-and-ended-desk.browser.test.ts:88-91` sets `ended: { owesPerson: false, note: … }` by hand and asserts absence only.
- **Small inaccuracies.** The real note is `ended … with no slice offered — reaped on the next pass` (`ended-desk.ts:93`); the Changelog drops the tail. The Board-impact comment says "packages/board only", but Design part 2 changes `EndedDeskPlacement` in `packages/domain/src/rules/ended-desk.ts`.

## 2. Slices: buildable, and what "done" means

**`bug/ready-line-after-every-bind`: the fix is buildable; the test as written is not a test.**
- The window between :1089 and the 127.0.0.1 listen callback is one loopback `listen` (microseconds). The parent must read the line from a pipe and open a socket before that bind completes. On the unfixed code a "connect over 127.0.0.1 on the line" test passes almost every run. `port.test.mjs:211` and `:247` already connect over 127.0.0.1 right after the line and pass on main. The proposed test therefore duplicates them and stays green on the defect.
- The same test is wrong on a correct server. `port.test.mjs:222-230` records a GitHub Linux runner where the IPv4 bind failed; the board then serves `::1` only, by design. "Expects success" over 127.0.0.1 fails that run.
- A deterministic form exists. Move `bindNext` and the announce into a function that takes its listen operation as a parameter, for example `bindAll(addresses, listen, announce)`. A unit test gives it fake listeners whose callbacks the test releases by hand. The test then asserts that `announce` stays uncalled while any listen is pending, and is called exactly once after the last success or failure. This is order-deterministic and needs no sockets and no timing. Mutation check: put the print back in the first callback, and the test goes red on every run.
- The integration test can stay as a smoke test: on the ready line, every address either answers or got a `could not also bind <addr>` warning before the line. Run it once against the unfixed source and record the result. It proves nothing in either direction and must not be the done-when.

**`bug/released-desk-keeps-its-note`: blocked by Open Question 1, and the plan says so.** Its done-when ("the chosen section") has no value until that is answered. Part 1 (read the bound) is buildable now. `packages/fleet/src/shared/fleet-run.ts:69` `boundSecondsOf` already reads the key with a default; the board needs the same reading through `readConfigAsync`. A fleet-reading browser test is buildable only if the fleet fixture can write `.plot-worker.ending.json` and `.plot-worker.exit` into a desk, so the brief must name that fixture.

## 3. Open question 1: the section

Recommendation: **Quiet** (`sections.ts:44`, `💤 Quiet — still thinking, or dead?`), as an agent row that the domain sends there.
- A released desk is dead and waits to be reaped, which is the Quiet hint's second half. Quiet already holds rows that owe nobody a decision (`quietKind` in `domain/src/rules/quiet.ts:30`).
- Agent rows already come from a non-branch source (`brokenAgentRows`, `working-agents.ts:80`). A second filter, the inverse one (`ended?.section === 'quiet'`), reuses that path and the existing `rows.tsx:2505` note slot. No new component is needed.
- The branch-row badge is weaker. The desk is a *free* desk (`branch: ''`, `checkout` set: test :74-76). Its old slice merged, so the branch row, if it exists, sits in Done (folded by default, AgentList.tsx:365) or in no section at all. A badge there is unseen, and it joins on `checkout`, a display-only field (rows.tsx comment).
- A new section is not justified for a row that the next reap pass removes.
- Domain shape: `EndedDeskPlacement` gains `section: 'waiting-on-you' | 'quiet'`, derived from `owesPerson`, and is unit-tested in `ended-desk.test.ts`. The component only filters on it.

## 4. Open questions 2 and 3

- **Note lifetime:** for as long as the desk exists. The row is built from the registry entry, so it disappears when the reaper removes the desk, and no separate expiry is needed. Done-when: a fleet reading with the desk shows the row in Quiet; a fleet reading without the desk shows none.
- **`Worker bound` of 0:** pass `null`. `agent-loop.ts:478` and `:617` end the free wait only when `boundSeconds > 0`, so with 0 no wait ends at a bound, and "after 0 h" is false. `null` keeps the "at the wait bound" wording. Also say in the plan that the board reads the repository's config, while the loop reads the desk worktree's config with a `PLOT_WORKER_BOUND` override (`worker-loop.ts:2269`). The hours shown can therefore differ from what the desk ran under. Absent key: use 28800, the loop's default (:2269), not `null`.

## 5. Amendments

1. Slice 1 text: replace "a test connects over `127.0.0.1` on the line and expects success" with "extract the bind chain into a function with an injected listen; a unit test releases the fake listen callbacks by hand and asserts the ready line comes after the last bind settles; reverting the print to the first callback turns the test red. The integration check accepts a `could not also bind` warning before the line in place of an answer."
2. Resolve Open Question 1 to Quiet, as written in §3, and rewrite slice 2's line as "place a released ended desk as an agent row in Quiet with its note".
3. Design part 2: name the field (`section` on `EndedDeskPlacement`) and the domain unit test as the place the decision is tested. Add "browser test shows the row in Quiet" as the one rendering check.
4. Board-impact comment: say that slice 2 also changes `packages/domain/src/rules/ended-desk.ts`.
5. Resolve Open Questions 2 and 3 as written in §4. Add: absent key → 28800; and the board reports the repository's bound, not a desk's `PLOT_WORKER_BOUND` override.
6. Changelog line 2: quote the real note, including "— reaped on the next pass", or say "a note naming the bound".
7. Slice 2 done-when: the browser test builds its desk through the fleet fixture, with an ending record, an exit of 124, and a merged slice, and not through a hand-set `ended`.
