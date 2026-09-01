---
'@plot-pm/board': patch
---

The two Plans-tab browser tests whose subject is the board payload now serve
their own state and start no board.

`branch-served.browser.test.ts` and `plan-source.browser.test.ts` name a
scenario and override the field they are about — `server.branch` for one,
`planSource` and the cards for the other. Both previously spawned
`board-server.mjs` against the `tiny-garden` fixture and then routed
`/api/board` over it, so each paid for a process whose payload it discarded.
11 tests, 4.95 s → 1.85 s.

**Override ratio, for the plan's scenario-count gate.** The served payload
carries 44 top-level fields (18 board, 26 fleet). `branch-served` overrides 1
of them per test (2.3 %), `plan-source` overrides 2 (4.5 %); weighted over 11
tests the average is **1.82 fields, 4.1 %**. The gate fires above 50 %, so
`an-empty-estate` fits these tests with room to spare.

**No assertion changed its meaning, and one changed its input on purpose.**
`plan-source` asserts twice about a payload the schema cannot produce: an older
server that sends no `planSource`, and one that sends no `behind`. `BoardSchema`
defaults both, so `board()` always returns them — and a defaulted `planSource`
renders the `unresolved` line where the test asserts silence. Those two cases
therefore layer `page.route` over the served baseline and delete the key, which
is the interception-over-baseline pattern `unreachable-overlay` established for
a board that cannot answer. Verified by sabotage: with the deletion disabled the
`planSource` case fails.

**Two files the brief listed did not migrate, and the reason is a gap in the
catalogue rather than in them.** `a-board-of-plans` carries `sprints: []` and
`stories: []` while naming a sprint and a story on its cards. The board derives
its sprint filter from `board.sprints` and its story overlay from
`board.stories`, so `tiny-garden.browser.test.ts` (3 sprint-filter tests) and
`story-overlay.browser.test.ts` (all 12) have nothing to filter or open. Both
also read the `/plan/<file>` and `/story/<slug>` document routes — markdown the
real server renders from the fixture's own files, asserted down to
`<h2>Approach</h2>`, the `?embed=1` titlebar and an `h1` — and the mock serves
neither. A scenario with a populated `sprints` and `stories`, and a decision
about document routes, are Naming-slice deliverables; migrating these two
without them would replace a real dependency with a fixture that asserts the
mock's own opinion.
