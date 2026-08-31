---
'plot': patch
---

Survey the 33 board-spawning browser tests and record the suite's baseline: 456 s for `pnpm run test:board` (383 s for the browser project) on an Apple M4, 10 cores, load 2.41→3.17, well inside the 1200 s bound. The population is 32 rather than 33 — `mock-board.browser.test.ts` matched only on a string it greps for — and three of those speak HTTP without a browser, leaving 29 files and 350 tests. Twenty of the 29 already stub `/api/fleet` and 17 never read `/api/board`, so they spawn a board to serve `index.html`; the write-route hypothesis holds for exactly one file, `approve`, where a POST reaches the configured script. Records what `agents-tab` needs (ten distinguishable rows, a WORKING section derived from the registry, and a mutable served state for its fail-switch and push helpers), and hands on that `plot-reap.sh` depends on the tiny-garden fixture being churned by tests.
