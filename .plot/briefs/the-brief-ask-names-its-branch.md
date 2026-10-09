## Implementation brief — a-slice-whose-brief-is-being (wave 1: The ask names its branch)

- **Plan (canonical):** `docs/plans/2026-10-09-a-slice-whose-brief-is-being.md` on `main`
- **Approved:** 2026-10-09, jwloka, in-session
- **Branch:** `feature/the-brief-ask-names-its-branch` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

Wave 2, `feature/the-row-shows-the-brief-writer`, waits on this branch. It builds `briefWriterState` from the readings this branch makes per-branch, so the shape of `BriefReading` that you leave is its input. Do not start the domain rule or the indicator here.

### What to build

A `--brief-only` run records the branch it briefs, and `briefReading` attributes a running or failed writer to that branch only.

The observed failure (issue #1417, measured 2026-10-09 ~08:40 UTC): `/api/fleet` carried `briefAskedAt` = 01:03 UTC on all four NOT STARTED slices of `the-fleet-runs-without-the-board`, hours after the brief run ended, while the slices being briefed showed nothing during the run. The reading is wrong in both directions.

Two mechanisms are known:

- **The implement route's state is keyed per plan.** `implementLogPath` and `implementStatePath` (`packages/board/src/server/implement.ts:64`, `:77`) name `.worktrees/plot-implement-<plan-slug>.{log,state}`. `startImplement` (`implement.ts:204`) receives only the plan slug, so one run marks every brief-less sibling. `briefReading` (`packages/board/src/server/brief-ask-log.ts`) reads that state through `implementRunState(repoRoot, planSlug)` and attaches it to every branch of the plan.
- **`startImplement` has two callers**: `dispatch.ts:429` and the `/api/implement` handler (`implement.ts:408`). Both pass a plan slug. The branch a `--brief-only` run briefs is known to the prompt `composeImplementPrompt(slug)` only as "the wave whose prior waves have merged", chosen by the skill, not by the caller. So the board does not know the branch when it starts the run. Decide where the branch is recorded, from what the callers and the skill know, and write the decision into the PR body. The plan leaves the file shape open on purpose: the state file, or a per-branch file beside the plan-keyed one.

Close by reading the plan: it is canonical, this brief is orientation.

### Settled decisions — do not re-derive them

**The change narrows the reading and never widens it.** A run that names no branch, such as a full `/plot-implement` without `--brief-only`, keeps today's per-plan reading. A test must show a sibling slice is no longer marked while a run names another branch, and that a branch-less run still marks the plan.

**"Running" is read from the writer's process, not from a log's age.** `markBoardRun` writes `running <pid>` into the state file before a run (`board-run.ts:138`), and `readRunState` (`board-run.ts:295`) checks that pid with `alive`. This reverses the #905 decision recorded in the `brief-ask-log.ts` header, which refused to read a process because its author mistook a 0-byte log at 25 and 40 seconds for a dead writer. The log is still not evidence: an empty log is an ask like any other, and size must not decide anything. Update that header so it states the new reading; it describes behaviour that no longer holds.

**An age stays a note and never decides the indicator.** `briefAskedAt` keeps its meaning. This branch changes which branch a run is attributed to; wave 2 adds the `writing`/`failed`/`asked`/`none` answer.

**A run that recorded `0` is no ask.** `briefReading` already refuses it, because the log is keyed per plan and outlives its run while a brief is per branch. Keep that.

**Measure before you change the reading.** The plan's three open questions are this branch's first task, and the PR body answers each with the command and its output:

1. Where did `briefAskedAt` = 01:03 UTC come from? On 2026-10-09 ~10:30 the main checkout's `.worktrees/plot-implement-the-fleet-runs-without-the-board.state` held `0`, which `briefReading` does not count, and no `.plot/brief-<branch>.log` or `.plot-brief-<plan>.log` existed for the four slices. Either the board that served `/api/fleet` ran older code, or a fourth asker writes elsewhere. Search before assuming; `git log -S` on `brief-ask-log.ts` and a look at the board's start time are the cheap probes.
2. Which condition hid the note while a writer ran: `needsBrief` false (`row-identity.ts:134` reads `startability === 'needs-brief'`), the row in another section, or no row before the slice appears?
3. Does a writer started by the fleet supervisor write the same state file with its own pid? If not, the process reading needs the supervisor's record too, and that goes into the PR as a finding for wave 2 rather than being built here.

If the measurement shows a row missing or in another section, report it and name the file. The plan puts that placement fix in wave 2's domain property, not in `.tsx` and not here.

**Rules carried over unchanged.** Absent is not false: a missing state file, a missing log or an unreadable mtime means *no claim*, never *no writer*. Read the recorded exit and the pid, not the emptiness of a file. `briefReading` never throws and never spawns beyond the existing `alive(pid)` check.

### Done when

The plan's two-line slice entry is the specification: a `--brief-only` run records the branch it briefs, the reading attributes a running or failed writer to that branch only, and the 01:03 source and the hidden-note condition are measured first. Lift these assertions, each of which a naive implementation would pass without:

- **Two slices of one plan, one run naming slice A.** Slice B's `askedAt` and `failed` are `null`. A naive change that records the branch but still reads the plan-keyed state passes every single-slice test and fails only here.
- **A run naming no branch marks every brief-less slice of its plan, as today.** This catches a change that widened the narrowing into a regression for the full `/plot-implement` path.
- **A run whose pid is dead reads `failed` for its own branch only.** `readRunState` returns `failed` with `STOPPED_RECORD` for a dead pid; a fixture with a live pid hides that arm. Use a pid that cannot be alive and one that is, and make the two arms disagree.
- **A state file that records `0` is no ask for any branch.** This catches attributing a finished run to its branch.
- **`brief-ask-log.test.ts` still pins `DISPATCH_SCRIPT_ASK_LOG` against `plot-dispatch.sh`'s own line.** Do not edit that script; the pin is why the constant exists.

Plus: add a changeset for `@plot-pm/board` (description first, `bumps:` block last, and a `plan:` line inside the block; `./scripts/check-changeset-packages.sh` refuses the other order). The board artifact is rebuilt by main after merge, so the PR carries no generated bundle (`scripts/check-no-bundle-diff.sh`).

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run no full suite, and do not run `test:e2e`. Do not run board tests while the operator's board is open on this machine; `test:board` takes it down.

Any function you write is an arrow, `export const f = (…) => …`, as the rule follows the diff. If you touch a `.sh` file, `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base; growth is paid for in the same change, by removing shell elsewhere or by writing the rule in the domain and asking it through a bundle. The expected change here is TypeScript only.

### Bookkeeping

Open the PR through the controller: `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). Do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.

Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/src/server/brief-ask-log.ts`, `packages/board/src/server/implement.ts`, the call in `packages/board/src/server/dispatch.ts`, the `briefReading` call in `packages/board/src/server/fleet.ts` (around `:7358`), their tests under `packages/board/test/unit/`, and the changeset.

It does not own `packages/domain/**`, `packages/board/src/app/**` (`BriefLine`, `briefNote`, `needsBrief`), or the fleet payload schema in `packages/board/src/contract/schema.ts`. Those belong to `feature/the-row-shows-the-brief-writer`. If the per-branch reading needs a new field in the payload, report it in the PR and leave the schema to wave 2.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
