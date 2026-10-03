## Implementation brief — every-desk-state-has-an-exit (slice 2: A refused slice is held)

- **Plan (canonical):** `docs/plans/2026-10-03-every-desk-state-has-an-exit.md` on `main`
- **Approved:** 2026-10-03, jwloka, in-session
- **Branch:** `bug/a-refused-slice-is-held` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** the PR, per repo convention
- **Issue:** #1243

This is slice 2 of 3. Slice 1 (`bug/an-empty-claim-is-not-unlanded-work`) merged as #1244. `bug/the-desk-has-a-lifecycle` waits on this slice and does not start until it merges.

### What to build

Measured 2026-10-03: an agent handed `bug/the-queue-reads-the-scans-order` wrote `PLOT-BLOCKED.md` and stopped. `rules/queue.ts` has no hold for that, so the next pass read the slice as queued and handed it to another free agent, and `--start-agents` started more agents for work nobody took. 250 desks came from one slice, at 17 to 19 desks an hour.

The change has a domain half and a reading half.

**Domain half (certain).** In `packages/domain/src/rules/queue.ts`:

- `QueuedSlice` gains `refused: boolean`, a reading the caller takes. The queue reads no files.
- `QueueHold` gains `'refused'`, with a TSDoc block that states what the word means and not how it was decided.
- `whyNotReady` returns `'refused'` for a slice that is `claimable` and `refused`, after the landing tests and `slice-unnamed`, before the brief gate. Bounding it to `claimable` is the same discipline `slice-unnamed` follows: a slice no plan makes startable stays `not-claimable`, so the estate's backlog does not move into the new word.
- `QUEUE_HOLDS` lists `'refused'` at the position `whyNotReady` tests it, so the tick line prints `refused=N` through `registryd.ts:359` with no edit there.
- `HOLD_SCOPE` in `packages/board/src/server/entry/registryd-main.ts:1296` is a total `Record<QueueHold, …>`, so the build fails until `'refused'` has a key. Give it `'queue'`: the hold is proportional to the slices an operator is waiting on, and the branch name is the whole of the repair.

**Reading half (open in the plan; settle it first).** `readQueue` in `packages/board/src/server/queue-reading.ts` sets `refused` through a new `QueueWorld` member. The plan's first open question names two candidates:

1. A `PLOT-BLOCKED*` file in a desk whose manifest names the branch. The plan measured 248 desks reading `owner: nobody`, so the manifest may already be cleared when the supervisor looks. Check this against a real desk before choosing it.
2. A line the loop appends to `.plot/state/` when it writes the marker. `blocked_on_held_checkout` (`skills/plot/scripts/plot-worker-loop.sh:1037`) is the writer for the measured case and already holds `$branch`.

Decide with a measurement, record the answer in the plan's Open Questions as a dated line, and then build it. If neither candidate reads the measured case, write `PLOT-BLOCKED.md` and report; do not parse the marker's prose for a backticked branch name.

The hold ends when the refusal is gone: the marker is cleared, or the record line is removed. It never ends on a timer.

### Decisions the plan settles — do not re-derive them

**The queue does not read files.** `QueuedSlice` documents every field as a reading the caller takes (`briefPresent`, `claimable`, `unnamed`). `refused` follows that shape. Rejected: a rule that takes a path or a desk list. It would decide a second time what *a refusal* means, which is the drift `briefPresent`'s comment records.

**`refused` is a hold, not a state of the slice or the agent.** No stored queue and no persisted verdict: the hold is derived each pass from the reading, so a daemon restarted mid-pass loses nothing (`QueuedSlice` header).

**`--start-agents` needs no second change, but the slice must prove it.** The plan's second open question says the start rule should already see nothing to take once the slice leaves the queue. Add a test in the `assign — the tick starts agents when queued > running` block (`packages/domain/test/queue.test.ts:326`) where the only queued slice is `refused`: the tick starts no agent. If that fails, the start rule counts held slices and the fix belongs here.

**Not in this slice.** Reaping the desks a refusal leaves behind (slice 3), `reapable.ts`'s `blocked-marker` refusal (slice 3), and slice 1's reading (merged).

### Done when

The plan's slice line is the specification. These assertions exist because a naive implementation passes without them:

- A claimable, briefed slice with `refused: true` is held `'refused'` and handed to no free agent, with agents free. Catches a hold that is counted and not enforced.
- The same slice with `refused: false` is handed over. Catches a hold that fires on every slice.
- `refused: true` on a slice with `claimable: false` reads `not-claimable`. Catches the hold swallowing the estate's backlog.
- `refused: true` on a slice whose `landed` is `landed` reads `already-merged`. A merged slice is finished, and a refusal on it is history.
- `holdCounts` returns a key for `'refused'`, zero where none fired. The existing test at `queue.test.ts:446` shows the shape.
- The tick line prints `refused=N`. Assert it in `packages/board/test/unit/registryd-tick.test.ts` beside the other hold keys.
- Reading half: a world whose desk carries the refusal sets `refused: true` for that branch only, and a world whose refusal is cleared sets it `false` on the next read. Catches a reading that latches.

Plus the repo's gates:

- A `.changeset/*.md` naming `'plot': patch` and `'@plot-pm/board': patch` only if the board package changes; description first, `bumps:` block last, and `plan: docs/plans/2026-10-03-every-desk-state-has-an-exit.md` in the block. A board change uses the package frontmatter and no `bumps:` skills entry.
- `pnpm build:board` after any `packages/board/src` change, then commit the rebuilt artifact. On a conflict in `board-server.mjs`, take either side and rebuild.
- Arrow functions for every function you write, including tests.

Before each push, run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. The suites in the `CI suites` key run in CI; a failure there comes back as a correction. Run no full suite locally, and not `test:e2e`.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`. Then append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`.

### Scope guard

This branch owns `packages/domain/src/rules/queue.ts`, `packages/domain/test/queue.test.ts`, `packages/board/src/server/queue-reading.ts` and its tests, the `HOLD_SCOPE` record in `packages/board/src/server/entry/registryd-main.ts`, the reading's world implementation there, and, if candidate 2 is chosen, the marker write in `skills/plot/scripts/plot-worker-loop.sh`.

In flight, verified 2026-10-03: PR #1234 (`bug/the-monitor-follows-the-hop`) also edits `test/reconcile/workerloop.test.mjs`. Put any shell test in a file of its own. Check `git log origin/main -- packages/board/src/server/entry/registryd-main.ts` before editing it; it is a busy file.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
