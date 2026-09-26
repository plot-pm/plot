## Implementation brief — a-dispatch-does-not-hold-the-loop

- **Plan (canonical):** `docs/plans/2026-09-26-a-dispatch-does-not-hold-the-loop.md` on `main`
- **Approved:** 2026-09-26, Jan Wloka, in-session after panel (round 1)
- **Branch:** `bug/a-dispatch-does-not-hold-the-loop` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code
- **Issue:** #1012

One slice, one wave. Nothing waits on it and it waits on nothing.

### What to build

`packages/board/src/server/dispatch.ts:356` runs the `Implement command` through `spawnSync` with `timeout: 5 * 60 * 1000`. For up to five minutes the board answers no request. Measured 2026-09-26: the port holder sat at 0.0% CPU, `/api/board` timed out, and the page told the operator to restart a live server. Move the wait off the event loop. Keep the brief gate: a non-zero implement still refuses the dispatch, names the log, and starts no worker.

The plan is canonical. This brief gives orientation only.

### Facts the plan did not have — verified at dispatch

**The shipped target exists, one file over: `src/server/implement.ts`.** The plan says *"There is no shipped target two files over"*. That holds for `deliver.ts` and `approve.ts`, and not for `implement.ts`. `handleImplement` (`implement.ts:241-313`) runs the SAME command through the SAME prompt (`composeImplementPrompt`) into the SAME log (`implementLogPath`). It uses `spawn` with `detached: true`, and the `exit` listener writes the code to a state file (`implementStatePath`). It answers `202`. `implementStatus` (`implement.ts:132`) reads the outcome back as `running | done | failed | unknown`, with the log's last lines as `message`. `GET /api/implement/<slug>` serves it (`index.ts:701`). So shape B's status endpoint is already built. Shape A's exit listener is already written, too. Read this file before you choose. Record in the PR why you reuse it or why you do not.

**The refusal does not reach the operator today.** The client aborts every action at `ACTION_TIMEOUT_MS = 15_000` (`src/app/lib/bounded-fetch.ts:45`). The server holds the request for up to 300 000 ms. A real `/plot-implement` run takes minutes. So the button gets `Fetch is aborted`, never the `409 implement-failed`. The plan's motivation lists this symptom. Its "What the row must say" section assumes the 409 arrives today, and in practice it does not. The fix does not trade a working refusal for a read-back. It gives the refusal its first route to the operator.

**The Dispatch menu drops the refusal even when it arrives.** `src/app/lib/agent-rows/menus.tsx:1283` reads `body.error` only. `/api/dispatch` refuses with `{ok, slug, reason, detail}` and never sends `error`. `StartWorkButton.tsx:271` fixed the same defect on 2026-09-02 (`detail` first, `error` second). The menu path did not get that fix. There are two callers. Both must show the refusal, and a test must cover each one.

**Dispatch and implement share one log and not one state file.** `dispatch.ts:345` truncates `implementLogPath(slug)`, and it never writes or clears `implementStatePath(slug)`. After a dispatch, `GET /api/implement/<slug>` reads a stale state from an earlier `/api/implement`. With no earlier run, it reads `running` forever (the log exists and has no state file). If you route the dispatch through the implement state, clear the state before the spawn, as `implement.ts:248` does.

**Ownership is settled.** `production-calls-the-domain-one-rule-at-a-time` is **Released**. No remote branch touches `dispatch.ts` (checked across every `origin/*` ref at dispatch). This plan owns the call site. Say so in the PR in one line, because the plan asks the slice to state it.

### Decisions to take as settled

**The brief gate stays.** `plot-dispatch.sh` runs only after the implement exits 0. Do not start the dispatch in parallel with the implement. Do not start it on a timer. Do not start it on "the brief file exists".

**The bound stays.** A hung implement must not hold a slot forever. `spawn` accepts `timeout` and `killSignal` (Node ≥ 15.13). A timeout kill must read as `failed` with a message that names the timeout. It must not read as `running` or `unknown`.

**The six bounded git spawns stay.** `idea.ts:657, :670, :683, :691, :696` and `continue.ts:179` are out of scope. Change one call site.

**The read-route gate stays as written.** Do not add write routes to `test/unit/a-read-route-spawns-nothing.test.ts`. Its "two seconds" price is the recorded decision this plan argues against for one call. Rewriting the gate is a larger change.

**The two spawns keep their order.** `recordActionReceipt(opts.repoRoot, 'dispatch', slug)` still comes immediately before `scriptsFor(opts).start(DISPATCH_SCRIPT, …)` (`dispatch.ts:436-437`). If the start moves into an exit listener, the receipt moves with it. `plot-controller-gate.sh` refuses a dispatch that has no receipt.

**`detached` without `unref`**, for `implement.ts:307`'s reason. The handle keeps the exit listener alive. Without it, every dispatch reads as `running` forever.

### Traps a naive implementation passes without

- **A second click.** The synchronous route serialised two POSTs for one slug, because it blocked everything. An async route runs two implements at once. Both truncate the same log, and both may start `plot-dispatch.sh`. Refuse a second dispatch while the first is `running`, and name the refusal. The client's `inFlight` ref lives in one tab and one render. It does not stop a second tab or a reload.
- **The exit listener throws.** In a listener, a thrown error from `fs.openSync(dispatch log)` or from `start` is an uncaught exception in the server. Catch it and record it where the status read-back finds it. A dispatch that fails after the 202 and says nothing is the outcome the plan calls *"worse than one that blocks"*.
- **The tests assert the old order synchronously.** `test/dispatch.test.mjs:73-82` expects the 202 body to carry `implementLog` and the implement stub to have run once when the response arrives. With the wait moved, the dispatch stub runs after the response. Wait for the child to exit (`.plot-worker.exit`, the state file, or a poll on the status route) before you assert. Do not raise a timeout to win the race.

### Done when

The plan's `## Done when` list is the specification. The assertions that exist because a naive fix would pass without them:

- **`/api/board` answers within `SERVED_WHILE_BUSY_MS` (250 ms) while an implement stub sleeps.** Reuse `test/integration/serves-while-it-reads.test.ts`'s harness: POST unawaited, `/api/board` in the same tick. The stub must sleep longer than the threshold (for example 2 s). Otherwise the test passes on the synchronous code.
- **A non-zero implement reaches the operator as a refusal naming the log, and `plot-dispatch.sh` never runs.** Assert on the dispatch stub's run count after the implement child exits, not at response time.
- **A successful implement still lands the dispatch.** The stub dispatch runs once, after the implement.
- **Both client callers show the refusal's `detail`.** `StartWorkButton` and the `menus.tsx` Dispatch entry.
- **The contract change is written down.** No board API reference document exists (`grep -rl api/dispatch docs/*.md` finds only `release-2.7.0-acceptance.md`). The route's contract lives in the `handleDispatch` docblock (`dispatch.ts:246-266`). Its line *"the 202 is written only after it completes successfully"* becomes false. Rewrite that docblock, and state the change in the changeset.

Plus the repo gates (Node 24 — `nvm use`, or `corepack pnpm`):

```bash
pnpm install
pnpm test
pnpm run test:contracts
pnpm run test:board      # rebuilds skills/plot/scripts/board/board-server.mjs
pnpm run typecheck
```

Commit the rebuilt `board-server.mjs`. Add a changeset with `'@plot-pm/board': patch` frontmatter and no `bumps:` block. Do not run `test:e2e` locally.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work still moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to the branch's line in the plan's `## Slices` section on `main`.

### Scope guard

This branch owns:

- `packages/board/src/server/dispatch.ts`
- `packages/board/src/server/implement.ts` and `src/server/index.ts`, only if you reuse the implement state or add a status route
- `packages/board/src/app/components/StartWorkButton.tsx` and `src/app/lib/agent-rows/menus.tsx`, the Dispatch entry only
- `packages/board/test/dispatch.test.mjs`, a new or extended test under `test/integration/`, and the client tests for the two callers
- `skills/plot/scripts/board/board-server.mjs` (generated), one `.changeset/*.md`

In flight at dispatch: no other remote branch touches `dispatch.ts`. `a-decision-reads-the-index` (`infra/the-index-has-its-first-consumer`) and `a-corpus-test-says-what-it-verifies` started today. `a-decision-reads-the-index` quotes `dispatch.ts:356` once, as a measurement (line 66), and changes nothing in it. The other plan names none of these files.

The spawn ratchet in `.github/workflows/ci.yml` (*One place reaches a process*) counts direct `spawn`/`spawnSync` sites outside `adapters/` and fails when the count grows. Replacing `spawnSync` with `spawn` keeps the count at one. A second spawn site (a copy of `implement.ts`'s spawn inside `dispatch.ts`) grows it. Reusing `implement.ts`'s spawn shrinks it.

If you find something the plan did not anticipate, report it. Do not improvise outside scope.
