## Implementation brief — no-controller-resumes-a-claimed-slice (wave 2: A time-out writes its ending)

- **Plan (canonical):** `docs/plans/2026-10-09-no-controller-resumes-a-claimed-slice.md` on `main`
- **Approved:** 2026-10-09, jwloka, in-session
- **Branch:** `feature/a-time-out-writes-its-ending` (base: `main`) — not claimed; the supervisor hands it to a free agent
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Wave 1 (`bug/a-working-desk-never-reads-free`, #1429) is merged. Wave 3 (`feature/a-timed-out-slice-gets-a-fresh-agent`) waits on this branch: it consumes the endings this branch guarantees. Do not start its work here.

### What to build

The plan says an agent that exits 124 can leave no ending, so the supervisor has nothing to answer. **Measure that claim before you build on it.** The desk of the reproduced case, `.worktrees/free-1c9c57a0` (`feature/the-fleet-package-exists`), holds `.plot-worker.ending.json` with `reason: quiet`, `actor: monitor`, branch `feature/the-fleet-package-exists`, written at 10:49 local — the same minute as `.plot-worker.exit` (`124`). So on that desk the idle path did write an ending. The plan's Motivation and the board's `ending: null` read for that desk disagree with the file.

Both time-out paths of the worker loop already write an ending through `agentLoop`:

| Exit path | Where | Ending written |
|---|---|---|
| idle watch | `packages/fleet/src/server/entry/worker-loop.ts:1737-1741` → `agentLoop` row 5 (`agent-loop.ts:~605`) | `quiet` / `monitor` |
| run bound | `worker-loop.ts:1743-1759` → `agentLoop` row 6 (`agent-loop.ts:~617`) | `bound` or `unreadable` / `bound` |
| SDK run bound | `agentLoop` row 9a (`agent-loop.ts:~674`) | `bound` / `bound` |
| free-wait bound | `agentLoop` row 2 (`agent-loop.ts:~473`), logged at `worker-loop.ts:1610` | none, by design: no slice held |

So your job has three steps, in this order. Stop and report after step 1 if it shows there is nothing to build.

1. **Find the exit 124 that leaves no ending, or prove there is none.** Candidates, each tested by a failing test on `origin/main`:
   - **The `ending: null` read.** Find where `/api/fleet` (and `plot-worker-state.sh`'s `plot_worker_ending`, `:417`) read the ending, and reproduce a desk with `worker: failed`, `.plot-worker.exit` = `124` and an ending file on disk that the read still reports as `null`. Check whether the read runs before the loop writes the ending, whether it filters the reasons `quiet` and `bound`, and whether it requires the branch to match.
   - **A 124 outside `agentLoop`.** `runPrompt` maps a missing status to 124 (`worker-loop.ts:1491`, `result.value.status ?? 124`); `promptExit` answers `unstarted` for any non-zero status (`rules/prompt-exit.ts:393`). A command killed by an outer `timeout` therefore reads as `unstarted`, not `bound`. Find out whether that is reachable.
   - **A process killed outright** (SIGKILL, machine sleep). No code runs, so no ending exists. This stays true: absent is absent.
2. **Fix what step 1 found, through `agentLoop`.** A path that needs an ending gets it by adding a reading to `agentLoop` and a row to its table, not by writing the file from `worker-loop.ts`. The ending reason is `bound` (or `unreadable` where no transcript exists) and the actor is `bound`, as rows 6 and 9a do.
3. **Correct the plan.** Amend the plan's Motivation and Done-when line for this wave to say what you measured: which path left no ending, or that none did and the defect was the read. Commit that with the fix.

### Settled decisions — do not re-derive them

**An exit code of 124 is not an ending.** `plot-worker-state.sh` reads an ending file or nothing; this branch must not turn `.plot-worker.exit` = `124` into a `bound` ending by inference. The ending comes from a path that knew why it stopped. The plan says so under Slice 1.

**The free-wait bound writes no ending, and that stays.** Row 2 means no slice was held and no agent worked. An ending there would put a `bound` reason on a desk with nothing to resume, and wave 3's `start-fresh` would then start an agent on a branch that does not exist. If you believe row 2 needs an ending, report it instead of adding one.

**The idle cause is already removed.** #1429 made the idle watch count subagent transcripts, so a delegating agent no longer reads silent. Do not change `transcript-fs.ts`, `assignSlice`, or the idle window here. A `quiet` ending that still fires is a true idle.

**`endingAction` is wave 3's.** `bound` and `unreadable` answer `leave` today (`rules/ending-action.ts`, the `EndingActionVerdict` table). Leave that row alone: this wave makes the ending exist and be readable, wave 3 answers it. Do not edit `ending-action.ts`.

**`unregistered` also ends 124** (`agent-loop.ts:470`, row 3) and already writes an ending. It is out of scope.

Rules carried over, unchanged:

- Absent is not false: a missing ending file is "no ending", never "not timed out".
- Read the exit code, not the emptiness.
- `packages/domain/**` is arrow functions and factual TSDoc; the reasoning goes in the commit message. A function you write or rewrite elsewhere is an arrow too.
- A controller calls the domain and never spawns. The loop's writes go through `performLoopWrites`.

### Done when

The plan's `## Done when` list is the specification; its first bullet belongs to this branch: *the exit path found in slice 1 writes an ending file with reason `bound` (or `unreadable`) and actor `bound`, and `/api/fleet` reads that ending for the desk.* Amend that bullet in this PR to name the path you proved.

Assertions that exist because a naive implementation passes without them:

- **The reproduction fails on `origin/main` first.** Run it on an unmodified checkout and paste the failing output in the PR. If every time-out path already writes and the read is correct, say so and stop with a report; do not add a write for a path that has one.
- **One test per row that writes `bound`/`quiet`/`unreadable`**, asserting reason, actor and branch. A test on the new row alone lets rows 5, 6 and 9a drift.
- **The ending names the held branch.** `registryd.ts` and `continueTarget` refuse an ending whose branch differs from the asked one; an ending written with `branch: ''` is read as no ending.
- **The free-wait bound still writes nothing** and still returns 124 (`detail.exitCode`). This catches a fix that adds an ending to row 2.
- **An ending written on exit 124 is on disk before the process exits.** The loop returns 124 straight after `performLoopWrites`; assert the file exists when `runWorkerLoop` resolves.

Plus the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. List no full suite. Add a changeset (description first, `bumps:` block last). A PR carries no generated bundle (`scripts/check-no-bundle-diff.sh`).

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file. If it does, remove an equal number of lines elsewhere in the same change, or write the rule in the domain and ask it through a bundle; the gate has no override.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves); never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/workflows/agent-loop.ts` and `packages/domain/test/workflows-agent-loop.test.ts`, `packages/fleet/src/server/entry/worker-loop.ts` and its unit tests (`packages/fleet/test/unit/worker-loop*.test.ts`), whatever reads the ending for `/api/fleet` if step 1 shows the read is the defect, and this plan's file. Wave 3 owns `rules/ending-action.ts`, `rules-ending-action.test.ts` and the `registryd.ts` tick; leave them alone.

Branches in flight, verified 2026-10-09 against `origin/main`: `feature/the-supervisor-is-plot-fleetd` changes `packages/fleet/src/server/entry/registryd.ts`, which this branch does not touch. No remote branch changes `worker-loop.ts`, `agent-loop.ts`, `ending-action.ts` or `ending.ts`. Rebase onto `main` before the PR.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
