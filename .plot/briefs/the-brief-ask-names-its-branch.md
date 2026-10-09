## Implementation brief — a-slice-whose-brief-is-being (wave 1: The ask names its branch)

- **Plan (canonical):** `docs/plans/2026-10-09-a-slice-whose-brief-is-being.md` on `main`
- **Approved:** 2026-10-09, jwloka, in-session
- **Branch:** `feature/the-brief-ask-names-its-branch` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

Wave 2 (`feature/the-row-shows-the-brief-writer`) waits on this branch: it reads the per-branch writer reading you add. It is not yours.

### What to build

A `--brief-only` run records the branch it briefs, and `briefReading` in `packages/board/src/server/brief-ask-log.ts` attributes a running or failed writer to that branch only.

The failure it fixes: the implement route's log and state are `.worktrees/plot-implement-<plan-slug>.{log,state}` and name no branch. Measured 2026-10-09 ~08:40 UTC, `/api/fleet` carried `briefAskedAt` = 01:03 UTC on all four NOT STARTED slices of `the-fleet-runs-without-the-board`, hours after the run ended. One run marks every brief-less sibling (the #1272 plan's Notes name this limit). The reading is wrong in both directions: absent while a writer runs, present on siblings long after it stopped.

Add a per-branch reading: a branch is attributed a `running <pid>` state (pid alive, via `readRunState` in `board-run.ts`) or a failed state only when the run recorded that branch. A run that names no branch (a full `/plot-implement`) keeps today's per-plan reading, so the change narrows the reading and never widens it. Which shape carries the branch — a field in the state file or a per-branch state file beside the plan-keyed one — is yours to decide from where `startImplement` (`server/implement.ts`) and the dispatch controller (`server/dispatch.ts:403,414`) know the branch. Record the choice in the PR.

**Measure first, before you change the reading** (the plan's three Open Questions; record the answers in the PR body and tick them in the plan):

1. Where did `briefAskedAt` = 01:03 UTC come from? On 2026-10-09 ~10:30 the main checkout's `.worktrees/plot-implement-the-fleet-runs-without-the-board.state` held `0`, which `briefReading` does not count, and no `.plot/brief-<branch>.log` or `.plot-brief-<plan>.log` existed for the four slices. Either the serving board ran older code, or a fourth asker writes elsewhere. Run the current code against that state before concluding.
2. Which condition hid the note while a writer ran: `needsBrief` false, the row in another section, or no row yet?
3. Does a writer started by the fleet supervisor write the same state file with its own pid? If not, the process reading needs the supervisor's record too.

### Settled decisions — do not re-derive them

**"Running" is read from the writer's process, not from an age.** `brief-ask-log.ts` states in its header that it never asks whether a writer runs; that was deliberate in #905 because the author misread a 0-byte log at 25 and 40 seconds as a dead writer (it reached 2553 bytes and landed). Size and mtime are evidence of nothing for a running writer. This plan reverses the decision only for the indicator, because `markBoardRun` (`board-run.ts:138`) already writes `running <pid>` and `readRunState` (`board-run.ts:295`) already checks it with `alive`. Do not add a second liveness check. An age stays a note beside the indicator and never decides it.

**Absent is not false.** A missing or unreadable state, or a pid you cannot probe, is *unknown*, never *not running*. Read the exit code and the recorded value, not the emptiness of a log.

**The slug coincidence is convention, not construction.** `plot-dispatch.sh` keys its log on the branch slug; the other two askers key on the plan slug. Do not assume they match; the directories always differ (`briefAskLogPaths`).

**The domain rule is wave 2.** Do not add `briefWriterState` or touch `.tsx` here. This wave changes the server reading only.

### Done when

The plan's wave line is the specification: a `--brief-only` run records the branch it briefs, and the reading attributes a running or failed writer to that branch only; the 01:03 source and the hidden-note condition are measured first.

Assertions that exist because a naive implementation would pass without them:

- **Two brief-less sibling slices of one plan, a running writer recorded for the first: the second reads no ask.** A test with one slice passes with the old per-plan reading.
- **A run that names no branch still marks every brief-less sibling.** Catches a change that widens or drops the legacy reading.
- **A state holding `running <pid>` with a dead pid reads failed, not running.** Catches a reading that trusts the file alone.
- **A run that recorded `0` is no ask for any branch.** The log outlives the run; a brief is per branch.

Plus: a changeset (`@plot-pm/board`, description first, `bumps:` block last), and `scripts/check-shell-lines.sh` if you touch a `.sh` (growth is paid for in the same change). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. Do not run board tests while the operator's board is open.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while moving), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

You own `packages/board/src/server/brief-ask-log.ts`, `packages/board/src/server/implement.ts`, `packages/board/src/server/dispatch.ts` (the branch it passes), their tests under `test/`, and the plan's Open Questions. `server/fleet.ts:7358` is the call site of `briefReading`; change it only to pass what the new signature needs. In flight: `feature/the-row-shows-the-brief-writer` owns the domain rule, `row-identity.ts` and `rows.tsx`. If you find something the plan did not anticipate, report it rather than improvising outside scope.
