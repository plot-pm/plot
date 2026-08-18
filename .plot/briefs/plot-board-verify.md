# Brief: feature/plot-board-verify

Implement **Task 4** of
`docs/superpowers/plans/2026-08-18-plot-board-setup.md`.

Read that plan first. It contains the complete script, the complete test file,
and the commands with their expected output. Its decisions were settled during
design and interrogation: **do not re-derive them, do not widen the scope.**

## What you are building

`skills/plot/scripts/plot-board-verify.sh` — starts the Plot board on an
OS-assigned port, fetches `/api/board`, prints the payload, and **reaps the
server on every exit path**. Plus its contract tests in
`test/reconcile/boardverify.test.mjs`.

## Why this is a script and not three lines of skill prose

The sequence is short enough to write into a SKILL.md as instructions. That
would be wrong, and `CLAUDE.md`'s *Gates Over Rules* section says why: "always
stop the server" is a **rule** an agent can believe it followed. The test is
*can you answer "did I complete this?" without doing the work?* — and for prose,
yes.

`trap cleanup EXIT INT TERM` is a **gate**: the shell reaps the process no
matter how the script exits, including the assertion-failure path that prose
forgets. That resource guarantee is the entire reason this file exists, so it
is the thing the tests must prove.

## The two things most likely to go wrong

1. **Do not assert specific column names.** `/api/board` returns the board's
   own five-stage *display* pipeline — measured 2026-08-18 in this repo:
   `Discovery / Design / Development / Endgame / Released`. These are **not**
   the four plan phases, and an older plugin build served
   `Draft / Approved / Delivered / Released` instead. Assert the payload's
   *shape*: a non-empty `columns` array whose entries each have a `phase` and a
   `cards` array. A gate naming those strings reports a broken board when the
   board is fine.

2. **Do not sleep a guessed interval waiting for startup.** Poll the server's
   own printed `localhost:<port>` line, as the plan's code does. A fixed sleep
   is either flaky or slow, and the bound port under `PORT=0` is not knowable
   in advance. Also check the process is still alive while polling, so an
   artifact that exits immediately fails fast with its output rather than
   hanging for ten seconds.

## Definition of Done

- `node --test test/reconcile/boardverify.test.mjs` passes (4 tests), including
  **both** no-leak assertions — success path and failure path
- `pnpm run test:reconcile` passes — no regressions
- `pnpm test` passes
- The leak guarantee proven against the real artifact:
  ```bash
  before=$(pgrep -fc board-server.mjs || echo 0)
  bash skills/plot/scripts/plot-board-verify.sh skills/plot/scripts/board/board-server.mjs | head -c 200
  after=$(pgrep -fc board-server.mjs || echo 0)
  echo "before=$before after=$after"
  ```
  `before` must equal `after`.
- A changeset with a `bumps:` block naming `plot: patch`

**Note:** the user has a board running on port 7777 during your run. `PORT=0`
means you cannot collide with it — but this is exactly why you must never
hardcode a port, and why the `after` count above may be nonzero as long as it
equals `before`.

## Out of scope

Do not create `plot-board-probe.sh` (that is `feature/plot-board-probe`, in
flight beside you) and do not create the `plot-board-setup` skill or touch any
documentation index (that is `feature/plot-board-setup-skill`, wave 2). Do not
touch anything under `packages/board/`.

If you find something the plan did not anticipate, implement what you can and
**report the discovery** rather than improvising.
