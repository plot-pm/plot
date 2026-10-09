## Implementation brief — no-controller-resumes-a-claimed-slice (wave 2: A time-out writes its ending)

- **Plan (canonical):** `docs/plans/2026-10-09-no-controller-resumes-a-claimed-slice.md` on `main`
- **Approved:** 2026-10-09, jwloka, in-session
- **Branch:** `feature/a-time-out-writes-its-ending` (base: `main`) — not claimed; the supervisor hands it to a free agent
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is wave 2 of 3. Wave 1 (`bug/a-working-desk-never-reads-free`, #1429) removes one cause of exit 124 and is in review. Wave 3 (`feature/a-timed-out-slice-gets-a-fresh-agent`) adds the `bound` rows of `endingAction` and waits on this wave: it answers an ending, so the ending has to exist first. Do not start wave 3's work here.

### What to build

Every exit 124 of a loop that holds a slice leaves an ending file, so the supervisor and `/api/fleet` have something to read. The failure it answers, 2026-10-09 on `feature/the-fleet-package-exists` at `.worktrees/free-1c9c57a0`: the loop exited 124 at 08:49:30Z with one unpushed commit and 50 uncommitted files on the desk, and the board read `worker: failed`, `ending: null`.

**The plan's premise needs checking before any code.** The plan's Motivation says the desk "wrote no ending record". Its answered Open Question says the opposite: the desk's `.plot-worker.ending.json` holds `reason: quiet`, `actor: monitor`, written by the idle path (`worker-loop.ts:1737-1741`, `agent-loop.ts` row 5). Both cannot hold. Wave 1's brief names a third path, the free-wait bound at `worker-loop.ts:1610`. The desk is gone or may be gone, so re-measure from the code, not from the desk.

The 124 exit paths that exist on `origin/main`, read 2026-10-09. Prove which of them writes no ending:

| Path | Where | Writes an ending? |
|---|---|---|
| Idle watch ends the run | `worker-loop.ts:1737-1741`, row 5 | yes: `quiet`, actor `monitor` |
| Bound kills the run | `worker-loop.ts:1480` → `:1743-1759`, row 6 | yes: `bound` or `unreadable`, actor `bound` |
| SDK run aborted on its bound | `agent-loop.ts` row 9a | yes: `bound` |
| Free wait reaches `Worker bound` | `agent-loop.ts` row 2, `worker-loop.ts:1610` | **no, by design**: no slice held, the row returns `decide('agent-loop', [], { exitCode: 124 })` |
| Command exits with status 124 or `null` without `timedOut` | `worker-loop.ts:1491`, `status ?? 124` into `promptExit` | **unmeasured**: check what answer `promptExit` gives and whether that answer reaches a `loop-end` write |
| Signal kills the loop | process level | no, and stays that way |

### Decisions the plan settles — do not re-derive them

**Reproduce first, and the reproduction may end this wave.** Write the failing test against an unmodified `origin/main` and paste its output in the PR. If every path that holds a slice already writes an ending, the premise is false: say so in the PR, make no code change, and stop with a report. A fix for a path you did not see fail is not wanted.

**Absent is absent.** `plot-worker-state.sh` reads a missing ending as `none`, and that stays true. This wave does not read an exit code of 124 as an ending, and it does not write one from the reader's side. The write belongs to the loop, through `agentLoop`, so the rule table stays the one place that names a reason.

**The free-wait row stays silent.** A free loop holds no branch, so there is nothing to attribute an ending to. Row 2's `exitCode: 124` with no `loop-end` is the table's own "none, 124". Writing a `bound` ending there would give the supervisor a slice to resume that does not exist. If your measurement says the free-wait path is the 2026-10-09 one, the answer is wave 1's, not an ending.

**Reasons and actor are fixed.** `bound` where a transcript is readable, `unreadable` where none is, actor `bound`. Do not add a reason; `EndingReason` is a closed set and wave 3's table is keyed on these two.

**`endingAction` is not touched.** It answers `leave` for `bound` today, and wave 3 owns the row. Do not edit `packages/domain/src/rules/ending-action.ts`.

Rules carried over, unchanged:

- `packages/domain/**` is arrow functions and factual TSDoc — no decision history in comments; the reasoning goes in the commit message. A function you write or rewrite elsewhere is an arrow too.
- The loop's decision stays in `agentLoop`, which reads readings and spawns nothing. A new path in `worker-loop.ts` builds readings and performs the writes `agentLoop` returns; it does not name a reason itself.
- Read the exit code, not the emptiness: a `124` in `.plot-worker.exit` is a measurement of how the process ended, not of why.

### Done when

The plan's `## Done when` first bullet is the specification: the exit path found writes an ending file with reason `bound` (or `unreadable`) and actor `bound`, and `/api/fleet` reads that ending for the desk. The assertions that exist because a naive implementation would pass without them:

- **The test runs the loop, not `agentLoop` alone.** A pure-domain test of row 6 passes on `origin/main` today. Drive the worker loop's exit path in `packages/fleet/test/unit/worker-loop.test.ts` and read the file the desk port wrote. This catches a fix that edits the table and leaves the missing call site missing.
- **The ending file exists after the loop returns 124, and names the branch.** Assert on the written record's `branch`, `reason` and `actor`, not on the return code alone.
- **The free-wait 124 still writes no ending.** This catches a fix that writes one on every 124.
- **A readable and an unreadable transcript give `bound` and `unreadable`.** One test each.
- **`/api/fleet` reads the ending.** The plan's first bullet names it; assert through the fleet reading, not the file.

Plus: a changeset for `plot`, level `patch`, with the description first and the `bumps:` block last (`./scripts/check-changeset-packages.sh`). The PR must carry no generated bundle (`scripts/check-no-bundle-diff.sh`); run `pnpm build:board` only to test locally, then restore the generated paths. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. List no full suite.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. If the fix touches a `.sh` file, pay for any growth in the same change — remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override. Expect no shell change: the paths above are all TypeScript.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. Name #1420 in the PR body. If the reproduction shows the premise false, record that in the plan's `## Open Questions` and the PR body instead of a code change.

### Scope guard

This branch owns `packages/domain/src/workflows/agent-loop.ts`, `packages/fleet/src/server/entry/worker-loop.ts`, `packages/fleet/src/server/entry/loop-writes.ts`, and their tests (`packages/domain/test/workflows-agent-loop.test.ts`, `packages/fleet/test/unit/worker-loop.test.ts`).

Verified at dispatch (2026-10-09, `git diff origin/main...origin/<branch>` over those files and `ending-action.ts`, `registryd.ts`): `bug/a-working-desk-never-reads-free` (#1429) touches `packages/fleet/test/unit/worker-loop.test.ts` and `performer-shell.ts`, so add your tests in a separate `describe` block and rebase if it merges first. `feature/the-supervisor-is-plot-fleetd` touches `registryd.ts`, which this wave does not. No in-flight branch touches `agent-loop.ts`, `ending-action.ts` or `loop-writes.ts`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
