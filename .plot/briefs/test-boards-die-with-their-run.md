## Implementation brief — board-survives-its-agents, wave 1 (Lifetime)

- **Plan (canonical):** `docs/plans/2026-08-17-board-survives-its-agents.md` on `main`
- **Approved:** 2026-08-17, jwloka, plan-PR #157 merged (two interrogation rounds)
- **Branch:** `bug/test-boards-die-with-their-run` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

### What to build

A board server started by the test harness **exits when the process that started
it is gone**. A board started by a person does not.

This wave goes first and alone, and the reason is not code: the other two waves
cannot be trusted to *fail honestly* until the test environment stops leaking
servers. Measured tonight — a full board run reported two failures that vanished
when the same file ran alone, and **two separate CI flakes hit markdown-only
PRs** (#162, #157), each passing 11/11 locally.

### The measurement

At 02:00 on 2026-08-17, four `board-server.mjs` processes:

| pid | listening | parent | started |
|---|---|---|---|
| 29222 | `localhost:56939` | **1** (`launchd`) | 01:54:31 |
| 35889 | `localhost:56967` | **1** (`launchd`) | 01:54:49 |

Random high ports means `PORT=0`, which is what `helpers.mjs` sets — these are
**test servers**. Parent PID 1 means the run that spawned them is gone. Both
still answered `/api/fleet` with **200**, so both were still polling. A third
appeared seconds after killing the first two, from an agent running its suite.

**Not a discipline problem:** 26 `startServer(` calls against 24 `.kill()` calls
in `after()` hooks. The tests clean up correctly — but `after()` never runs when
the runner is killed rather than finishing.

### Five decisions the plan settles — do not re-derive them

**`process.ppid` is the mechanism.** It becomes `1` the moment a parent dies,
**however it dies**. Measured with a probe: parent killed by `SIGKILL` (exit 137,
so no handler of its own could possibly run) and the child observed
`ppid changed 20996 -> 1` within **200 ms**. That is a gate, not a rule: the
server cannot *claim* to still have its launcher, it measures it.

**A global teardown is NOT the answer, and this was checked.** There is no
global teardown in the board's test config at all — cleanup lives entirely in
per-suite `after()` hooks. Adding one would run when the suite ends **in
order**, which is exactly what `after()` already covers. The orphans came from a
run that did *not* end in order, so a teardown would have missed both. **The
mechanism has to work when nothing gets to run.**

**They were orphaned, not detached.** `helpers.mjs:33` spawns **without**
`detached: true`, so these are ordinary children; POSIX handed them to PID 1
when their parent died. Do not "fix" this by adding `detached` — that would make
the problem deliberate.

**The gate is a NEW variable: `PLOT_EXIT_WITH_PARENT`.** `helpers.mjs` already
passes `PLOT_REPO_ROOT` and `PORT=0` to every test server, and the operator's
board sets neither — so either could serve as a tell, and neither should. One
variable, one question: `PLOT_REPO_ROOT` answers *where the repo is*, and
deriving *die with your launcher* from it would work by accident today and
surprise whoever sets it for its real meaning tomorrow.

**The distinction CANNOT be the ppid change itself.** This is the regression
that matters most. The operator's board is a child of the `node --watch`
supervisor, **which replaces its child on every restart** — so a naive "my
parent changed, therefore exit" is true for both, and the operator's board is
the one that dies. A board started in a terminal the operator then closes is
also deliberately allowed to keep running.

### Done when

The plan's `## Done when` list is the specification. The assertions that exist
because a weaker implementation passes without them:

- **A test server exits when its launcher is killed.** Assert against
  **`SIGKILL`**, not `SIGTERM`: a handler-based cleanup passes the polite case
  and leaves exactly the orphans this exists to remove.
- **A board started by a person does NOT exit when its shell closes.** The
  regression that matters — the naive form of this fix kills the operator's own
  board.
- **The gate is `PLOT_EXIT_WITH_PARENT`, not inferred.** Assert a server started
  with `PORT=0` **and** `PLOT_REPO_ROOT` but *without* the new variable keeps
  running.
- **A global teardown is not the mechanism.** Assert the exit happens when the
  launcher is killed outright.
- **No orphan survives a killed test run.** The end-to-end form and the actual
  defect: start the suite, kill the runner, assert no `board-server.mjs`
  remains. Every other assertion here is a component of it.

Plus: `pnpm run test:board`, `pnpm run test:reconcile`, `pnpm run typecheck`,
`pnpm run validate` all pass; `pnpm build:board` run **in your own worktree**
and the artifact committed (CI gates on no-diff); a changeset is present.
macOS bash 3.2 — **no `declare -A`**.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's
`## Branches` section on `main`. **Push your first real commit as soon as it
exists** — this repo lost sight of finished work three times on one branch in a
single day because it was never pushed.

### Scope guard

`packages/board/src/server/index.ts` (the ppid watch),
`packages/board/test/helpers.mjs` (setting the variable), and their tests.

**Explicitly out of scope, both from the same plan:** the pulse cache surviving
a `--watch` restart, and the scan reporting a locked worktree. Those are wave 2
(`feature/board-bridges-its-restart`, `bug/scan-reports-a-locked-worktree`) and
they rebase onto you — the whole point of the ordering is that they can trust
their own test results once you land.

**Also out of scope: the orphans running right now.** They are killed by hand
once; a reaper would be a second mechanism aimed at a set that only shrinks, and
one that kills other people's processes.

**Two other branches are in flight** — `feature/pr-state-travels-as-a-field`
(editing `schema.ts` and `fleet.ts`) and `feature/dispatch-reports-no-worker`
(skill prose). Neither touches `index.ts` or `helpers.mjs`.

`.gitattributes` marks `skills/plot/scripts/board/board-server.mjs` as `-merge`:
on a conflict there, take **either** side, run `pnpm build:board`, `git add` it,
continue. **Do not read that diff** — the rebuild overwrites whichever side you
took, so the choice genuinely cannot matter.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
