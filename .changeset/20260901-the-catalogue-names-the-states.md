---
'@plot-pm/board': patch
---

The catalogue can express the states the browser suite needs: 3 named scenarios become 8, each named for the state it describes rather than for the file that first wanted one. `a-full-estate`, `an-estate-that-cannot-act`, `a-plan-in-waves`, `one-row-per-kind` and `a-board-of-plans` join the three that existed, and every payload is built through `row()`, `wave()`, `card()`, `fleet()` and `board()` — 52 builder calls and no raw cast to a contract type, which is the shape that let a structurally valid, never-`.parse()`d `Fleet` ship with no `waves` array and render no action menu. `mock-board.browser.test.ts` gains one test per new shape, because a scenario nothing asserts against is a payload nobody has shown the board can render; the migration gate's test count is raised in this commit to match. No browser test migrates here — the catalogue is the deliverable, and moving files onto it is the next slice.
