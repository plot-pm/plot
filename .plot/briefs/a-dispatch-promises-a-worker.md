## Implementation brief — a-dispatch-promises-a-worker

- **Plan (canonical):** `docs/plans/2026-09-27-a-dispatch-promises-a-worker.md` on `main`
- **Approved:** 2026-09-29, jwloka, in-session
- **Branch:** `bug/a-dispatch-promises-a-worker` (base: `main`), claimed 2026-09-29 by ref push at `origin/main`
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** PR review per repo convention; CI is the authority for `test:e2e`
- **Issue:** #1027

The plan has one slice. Nothing waits on it and it waits on nothing.

### What to build

`POST /api/dispatch` answers `json(202, { slug, log, implementLog })` at `packages/board/src/server/dispatch.ts:471`. Since #1018 that 202 is written after `startImplement` **spawns** a detached `/plot-implement` child. At that moment no claim exists, no desk exists, and `plot-dispatch.sh` has not been invoked: it runs only inside the child's exit listener, after a zero exit (`dispatch.ts:407-458`). Every caller reads the 202 as *work is running*. Measured 2026-09-27: four desks, two live workers, and the endpoint answered success for all of them.

The fix is small. The 202 body names the act the route performed — an implement was started — and no field in it can be read as *a worker is running*. The body points the caller at the read-back where the fate becomes knowable. The plan is canonical; this brief is orientation.

### Settled decisions — do not re-derive them

**The response does not wait for anything.** Awaiting the implement or the dispatch script re-introduces the event-loop block #1018 removed (`f1c81383`). 18 of the 24 rows in `.plot/state/unowned-action-writes.tsv` name that blocked loop. Any design that needs the child's exit before `json(202, …)` is out.

**No `started`, `queued` or `claimed` field.** Each one describes a world that does not exist at response time. `started` needs the blocking above. `claimed` cannot be told apart from anything, because no claim exists yet. `queued`/`no-headroom` comes from a machine reading at a supervisor tick (`packages/domain/src/rules/supervision.ts:205`) over a desk that has not been cut. The plan dropped all three after round 1 for these reasons.

**The code's own paragraph is adopted, not argued with.** `dispatch.ts:464-470`: *"the response CANNOT carry a result … it is why the row moving is the answer rather than the reply being one."* A change that makes the response carry a worker outcome must first refute that paragraph, and the plan says it cannot be refuted.

**No controller verb and no row change.** No `restart`, no `release`. The row is #1030's.

**Rules carried over unchanged:**
- *Absent is not false.* A missing state file reads `running` or `unknown` in `implementStatus`, never `failed`. Do not collapse those.
- The `log` const is declared before the spawn for a TDZ reason (`dispatch.ts:398-403`). A fast-failing stub exits inside the same tick. Keep that order.

### Facts verified at dispatch (2026-09-29)

- **The read-back exists.** `GET /api/implement/<slug>` is routed at `packages/board/src/server/index.ts:701` and served by `implementStatus` (`implement.ts:333`). It returns `{ state, message, log }` with `state` in `IdeaState`: `running` (log exists, no state file), `done` (exit 0), `failed` (non-zero, `message` = the log's last lines), `unknown` (no log). The plan's claim about it holds. **Note what `done` means:** the implement exited 0 and the dispatch script was spawned. It does not mean a worker runs. Say that where the body points at this route; do not add to the route in this slice.
- **Neither client reads the 202 body.** `StartWorkButton.tsx:255-283` and `agent-rows/menus.tsx:1275-1300` read the body only when `!res.ok`. On success they stay `starting`/`dispatching` until the pulse moves the row. Changing the 202 body breaks no client, but keep their inline body types honest if you add a field they could read.
- **#1030 is released.** `a-desk-says-who-owes-it` merged as PR #1034 (`d330ddd8`, 2026-09-28). It added `entities/supervision-report.ts`, `rules/supervision-debt.ts`, `rules/supervisor-reading.ts` and `ports/supervision-report.ts` in `packages/domain`. Read these before building: the plan's last Done-when item asks whether what remains here is only a field there.
- **An open question for you to decide and record:** the `log` field names the dispatcher log (`dispatchLogPath`), which is written only if the implement exits 0. A caller can read a path to a dispatch log as *a dispatch ran*. The Done-when rule is "no field can be read as *a worker is running*". Decide whether `log` stays, is renamed, or is qualified. Record the decision in the PR body. `dispatch.test.mjs:74` asserts it today.

### Done when

The plan's `## Done when` list is the specification. The assertions that catch a naive implementation:

- **The stubbed implement has not exited when the response is asserted.** A stub that exits at once lets the exit listener run first, so a test passes even against a body that reports post-exit facts. Use a stub that blocks (for example `sleep` on a signal file you release after the assertion), and wait for the child's exit before teardown — `.plot-worker.exit`/the implement state file is the signal, not `rmSync` retries.
- **The assertion is on the whole body's keys**, not on one added key. A test that checks only a new `act: 'implement-started'` passes while a `started: true` sits beside it.
- **The `GET /api/implement/<slug>` claim is checked against the shipped route**, with a test or a quoted line, before anything is added to it (nothing should be).
- **The #1030 boundary is recorded.** State in the PR body whether any remainder belongs to #1030's supervision report. If it does, stop there and say so rather than building it.

Plus the repo gates:
- `nvm use` (Node 24); run pnpm as `corepack pnpm` if the Homebrew pnpm crashes.
- `pnpm test`, `pnpm run typecheck`, `pnpm run test:board` (it rebuilds `skills/plot/scripts/board/board-server.mjs`; commit the rebuilt artifact).
- Do **not** run `pnpm run test:e2e` locally; CI runs it.
- A changeset with `'@plot-pm/board': patch` frontmatter, description first. Copy the format from git history if `.changeset/` is empty.
- Under load, re-run a failing board test file alone before believing it.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). **Do not run `gh pr create`.**
- When the PR exists, append `(Branch: bug/a-dispatch-promises-a-worker, PR: #<N>)` inside the slice heading in the plan's `## Slices` — this plan annotates inside the heading, not with a trailing `→ #N`. Make that edit on `main` through a scratch worktree.

### Scope guard

This branch owns:
- `packages/board/src/server/dispatch.ts` — the 202 body and its docblock (`:262-276`, `:460-471`)
- `packages/board/test/dispatch.test.mjs` — the response-shape tests
- the inline body types in `packages/board/src/app/components/StartWorkButton.tsx` and `packages/board/src/app/lib/agent-rows/menus.tsx`, only if the body shape they declare changes
- the rebuilt `skills/plot/scripts/board/board-server.mjs` and one `.changeset/*.md`

Not this branch: `implement.ts`'s status route, `rules/supervision.ts`, the supervision-report files from #1034, any row or scan code.

Other branches in flight at dispatch (open PRs #1060, #1062, #1063, and the release PR #1047) touch none of the files above.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
