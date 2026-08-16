## Implementation brief — board-tells-the-truth (wave 2: Ports)

- **Plan (canonical):** `docs/plans/2026-08-16-board-tells-the-truth.md` on `main`
- **Approved:** 2026-08-16, jwloka, plan-PR #138 merged (two interrogation rounds)
- **Branch:** `bug/board-binds-port-zero` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

Wave 1 (`bug/board-shows-staleness`) merged as #141. This wave completes the plan.

### What to build

One root cause wearing three costumes: **a port is chosen at one moment and
used at another.** It caused a CI flake, a failed `pnpm board` start, and a
browser tab bookmarked on a port nothing serves — all on 2026-08-16.

**1. `PORT=0` binds zero and reports what the OS gave.** `index.ts:15` reads
`process.env.PORT ?? 7777` today, and **the fixed default stays**. A dev board
on a random port is not bookmarkable — turning that same evening's dead-bookmark
incident from an accident into the rule. Tests want isolation, the dev board
wants predictability; `PORT=0` serves the first without touching the second.

**2. The bound port must reach the origin check.** The sharp edge, and the one
thing that will silently break if missed. `dispatch.ts:154` calls
`isSameOrigin(req, opts.port)`, which guards `/dispatch` — the endpoint that
**spawns processes** — by admitting a browser `Origin` only when it matches
`localhost:<port>`. `const PORT` is evaluated at module load, before
`server.listen()`. Under `PORT=0` the constant stays `0` while the real port is
something else, so the allowlist reads `http://localhost:0` and refuses **every**
browser origin. Read `server.address().port` in the `listen` callback and pass
*that* to `handleDispatch`. This corrects an inconsistency that already exists;
`PORT=0` only makes it impossible to ignore.

**3. `findFreePort` is deleted — all 28 call sites, 8 files.** Counted:
`board`, `claimed`, `discovery`, `dispatch` and four integration suites. It
binds port 0, reads the number, **closes**, and hands it to a different process
that binds it later — the gap between `close()` and `listen()` is the race, and
CI runs test files in parallel.

Migrating one file would fix the flake that has been *seen* while leaving the
race in seven that have merely not failed yet, and would keep the helper alive
for the next test to reach for.

**`startServer` already knows the answer and throws it away.** It waits for
`http://localhost:` in stdout — that line carries the real port — but resolves
with the port it was *given* (`helpers.mjs:41–68`). Parse
`http://localhost:(\d+)` out of the line it is already reading: one line inside
the helper, no port file, no new protocol.

**4. A second `pnpm board` names the running one and exits 0.** Not
kill-and-restart: that would shoot down another worktree's board, and several
ran side by side the day this was found. **Catch `EADDRINUSE` from `listen()`**
rather than probing first — probing rebuilds the very check-then-act race this
branch removes. Today it dies with a raw stack trace that says a port is taken
without saying by what or where to go instead.

### Done when

The plan's `## Done when` list is the specification. Five assertions there exist
because the naive version passes without them:

- **`/dispatch` still accepts a same-origin request under `PORT=0`** — send an
  `Origin` matching the *bound* port, require non-403. A dispatch endpoint that
  fails closed looks fine until someone presses Start work.
- **No test file passes a port in** — all 28, not the one seen to fail.
- **The default port is unchanged** — starting without `PORT` still binds 7777.
- **The second `pnpm board` names the address** and does not kill the first.
- **It does not probe before binding** — the failed `listen` IS the check.
- **The nested-repo containment assertions still hold.** They are why that slow
  test exists; trading a flake for a hole is not a fix.

Plus: `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`, `pnpm run
validate` all pass; `pnpm build:board` run **in your own worktree** and the
artifact committed (CI gates on no-diff); a changeset is present.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Branches` section on `main`. **Push your first real commit as soon as
it exists** — three agents today finished work that stayed invisible because it
was never pushed.

### Scope guard

`packages/board/src/server/index.ts`, `dispatch.ts`, `packages/board/test/**`,
and the `board` script in `package.json`.

One other branch is in flight (`feature/agent-view-phase-ui`, on
`AgentList.tsx`) — no overlap with yours. The only shared surface is the built
artifact `board-server.mjs`, which every board branch rebuilds. On a conflict
there, do **not** read the diff: take either side, run `pnpm build:board`, and
continue. Which side you take cannot matter, because the rebuild overwrites it.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
