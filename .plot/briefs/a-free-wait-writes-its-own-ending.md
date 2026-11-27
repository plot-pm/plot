## Implementation brief — a-foreign-slice-is-never-claimed-here (wave 2: Free Wait Ending)

- **Plan (canonical):** `docs/plans/2026-11-27-a-foreign-slice-is-never-claimed-here.md` on main
- **Approved:** 2026-11-27, jwloka, plan-PR #3740 merged
- **Branch:** `bug/a-free-wait-writes-its-own-ending` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (`Review: pr`, `Auto-review: true`)

This is the second wave. It waits on wave 1 (`bug/a-foreign-slice-is-never-claimed-here`) by plan order only: the two slices share no file, and this one touches no pulse, dispatch or `branch-state` code.

### What to build

A free agent whose wait reaches `Worker bound` ends with exit 124 and writes no ending. The supervisor then composes `{"reason":"unreadable","actor":"supervisor","detail":"the worker exited 124 and wrote no ending"}` for the desk, so a clean, planned end reads as a failure. Measured in `.plot/state/endings.jsonl` on 2026-11-27: 14 of its 49 lines carry that detail. The worker log already says "Nothing was cut short" (`packages/fleet/src/server/entry/worker-loop.ts`, the `decision.detail.exitCode === 124 && readings.assignedBranch === ''` line).

The change has three parts:

1. `EndingReasonSchema` (`packages/domain/src/entities/ending.ts`) gains `free-wait-expired`.
2. `agentLoop` row 2 (`packages/domain/src/workflows/agent-loop.ts`, the `boundSeconds > 0 && waitedSeconds >= boundSeconds` arm) returns `end(worktree, '', 'free-wait-expired', 'agent', <detail>, 124)` instead of a bare `decide(...)` with no write. The `end` helper appends the `loop-end` write. Row 3 (`unregistered`) already shows the shape: branch `''`, actor `agent`, exit 124.
3. `endingAction` (`packages/domain/src/rules/ending-action.ts`) answers for `free-wait-expired` as it does today for a free wait that closed: `leave`, with no `start-fresh` and no `release-claim`. The desk reaps as a finished one, not a failed one.

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**The ending is the loop's own, actor `agent`. The supervisor does not learn to skip the exit code.** `killedWorkerEnding` already composes nothing where an ending exists (`readings.ending.read !== 'absent'` returns `null`), so writing the ending in the loop is the whole fix on that side. Adding an exit-124 exception to `killedWorkerEnding` is the alternative this rejects: the supervisor would then guess a cause from a number, which is how `unreadable` came to carry a planned end.

**`free-wait-expired` is not `bound`.** `bound` is the wall-clock watchdog firing on a worker that held work. A free wait holds no prompt, so naming `bound` claims a clock cut something short. The worker log says nothing was cut short. Keep the reasons apart.

**Every reader of the old signature must read the new one, or the desk regresses.** Three readers key on `reason: unreadable` + `actor: supervisor` + exit `124`. A change that only adds the enum value and the write passes its own unit test and breaks these:

- `freeWaitEnded` (`packages/domain/src/rules/ended-desk.ts`) — it decides whether `endedDeskPlacement` puts the desk in `quiet` ("reaped on the next pass") or `waiting-on-you`. With only the old signature, the new ending leaves every expired free wait in *Waiting on you* with no note. Make it true for `free-wait-expired` with actor `agent`. Keep the old signature true too: endings already on disk in `.plot-worker.ending.json` still carry it. Its callers: `packages/board/src/server/fleet.ts` (about line 8757) and `packages/fleet/src/server/entry/registryd.ts` (about lines 1017 and 1251).
- `endingAction`'s `freeWait` reading (`ending-action.ts`, the `bound`/`unreadable`/`quiet` row) — `registryd.ts` fills it from `freeWaitEnded`. `free-wait-expired` needs its own row or must reach the `leave` arm, and it must not reach the `BOUND_ENDINGS` row that asks `boundBranchHoldsWork`. An open PR or commit on the desk belongs to the PRIOR slice. That is the #1917 reading, and it holds here.
- The `ending-self-attributed` refusal in `packages/domain/src/transitions/agent.ts` (about line 467) allows actor `agent` only for a listed reason set, and its message lists them. Add `free-wait-expired` to the condition and to the message, or `recordEnding` refuses the new ending by name.

**Rules carried over from the same code.** Absent is not false: an absent or unreadable ending still answers `leave`. Read the exit code, not the emptiness of `.plot-worker.exit`. The row-2 comment in `agent-loop.ts` says "no ending reason applies here" and "the exit code lives in `detail.exitCode` rather than in a `loop-end` write". Both statements become false, so rewrite them as TSDoc facts: what the row writes and why exit 124 stays. Per `CLAUDE.md`, a doc comment states what the function does, not the history.

**Arrow functions.** Any function you write is an arrow, in the domain and in tests.

### Done when

The plan's `## Done when` is the specification; its test line for this slice reads:

- `agentLoop` with no assignment and `waitedSeconds` at the bound writes `loop-end` `free-wait-expired`, actor `agent`, exit 124, branch `''`.
- `killedWorkerEnding` composes `null` for that desk.
- The desk reads finished, not failed.

Lift these, because a naive implementation passes without them:

- **`endedDeskPlacement` puts a `free-wait-expired` desk in `quiet` when the desk is clean** (merged, not dirty, nothing unlanded, no marker), and in `waiting-on-you` with the prior-slice note when it is not. Catches: enum and write added, readers not.
- **`freeWaitEnded` stays true for the old `unreadable`/`supervisor`/`124` pair.** Catches: a desk whose ending was written before this change, which would flip back into *Waiting on you*.
- **`endingAction` for `free-wait-expired` answers `leave` with an open PR, an unpushed commit and a dirty tree each set.** Catches: the arm falling into the `bound` row and answering `start-fresh` or `release-claim` for the prior slice.
- **`recordEnding` accepts actor `agent` with `free-wait-expired`.** Catches: the `ending-self-attributed` refusal.
- **A row-2 pass at `waitedSeconds` just under the bound still writes nothing and waits (row 1).** Catches: an off-by-one that ends a live wait.
- **The worker loop's exit code is still 124** (`decision.detail.exitCode`), so the wrapper's `.plot-worker.exit` and the existing log line are unchanged.
- **Check the exhaustive consumers of `EndingReason`.** Grep `packages/` and `skills/` for `'nothing-done'` or `'permission-denied'` as a list of reasons. Each list that must name the new reason gets it. The board's wording for an ending is one such consumer. Do not add the reason where the list is about prompt endings.

Plus: a changeset for `@plot-pm/board` or `plot` as the nearest existing changesets show, with the description first and the `bumps:` block last (`./scripts/check-changeset-packages.sh`). Name the plan in a `plan:` line. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there returns as a correction. Do not run `test:e2e`. If you touch a `.sh` file, `scripts/check-shell-lines.sh` refuses growth: pay for it in the same change, or write the rule in the domain. This slice should need no shell edit.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/domain/src/entities/ending.ts`, `workflows/agent-loop.ts`, `rules/ending-action.ts`, `rules/ended-desk.ts`, `transitions/agent.ts`, their tests, and the one-line reader updates in `packages/fleet/src/server/entry/registryd.ts` and `packages/board/src/server/fleet.ts` if a reader needs them. It does not touch the pulse, `branch-state.ts`, `plan-walk-branches.ts`, `cross-repo-reference.ts` or `plot-dispatch-command.mjs`: wave 1 owns those. If you find something the plan did not anticipate, report it rather than improvising outside scope.
