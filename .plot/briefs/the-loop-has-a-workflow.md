## Implementation brief — the-worker-loop-runs-in-js (wave 1: The loop has a workflow)

- **Plan (canonical):** `docs/plans/2026-10-04-the-worker-loop-runs-in-js.md` on `main`
- **Approved:** 2026-10-04, jwloka, in-session
- **Branch:** `infra/the-loop-has-a-workflow` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention. The PR is reviewed as code, and CI is the authority for e2e.

This slice waits on `infra/the-shell-loop-holds-unlanded-work` (plan `the-shell-loop-holds-unlanded-work`). On 2026-10-04 that branch holds only its claim commit and has no PR. It adds `holding-work` to `EndingReasonSchema`, admits actor `agent` for it in `endingIsAttributable`, and rewrites the doc comment on actor `agent` in `entities/ending.ts`. This slice edits the same three places, so cut the branch from `main` after that PR merges, and do not copy its change. All five later waves of this plan wait on this slice: slice 2 (`infra/the-loop-writes-through-ports`) gives every `Write` kind defined here an arm in `performLoopWrites`.

### What to build

A pure domain workflow, `agentLoop(readings) -> Decision | Refusal`, in `packages/domain/src/workflows/agent-loop.ts`. It answers one question per pass: given what the loop measured, what does the loop write next, and does it end. Nothing calls it in this slice. Slice 3 is its first caller.

The failures it fixes are in the shell loop `skills/plot/scripts/plot-worker-loop.sh`, which no coverage tool measures (891 code lines, 52 functions, 2026-10-04):

1. A prompt turn ended with 14 uncommitted files, and the loop cut a new desk (#1246). `the-shell-loop-holds-unlanded-work` fixes this in shell. Here it is a table row.
2. A continued agent had no BuildMonitor, and its CI wait expired after 1,800 s with "no CI answer" while CI had failed (#1255, PR #1249).
3. A BuildMonitor reported the first failure and missed the run after the correction. The loop let go after 3,600 s, and correction 2 never ran (#1255, PR #1269).
4. An agent stopped on a `PLOT-BLOCKED` marker, its loop ended on the wait bound, and the board read exit 124 as a crash (#1250).

Failures 1 to 4 become cases in the workflow's table test. Failure 5 (old code in a long-running process) is slice 4's.

The parts:

- **`agentLoop`** over the plan's table (Design › Approach › *The table*, 18 rows). Each row is a test case.
- **New `Write` kinds** in `workflows/decision.ts`: `desk-reset`, `assignment-clear`, `prompt-run`, `correction-count`, `declaration` (`ok` or `blocked`), `slice-spend`, `loop-end`, `worker-finding`, `build-finding`. Each one also goes into `BEYOND_THE_FILESYSTEM` in `packages/domain/src/adapters/performer/perform-fs.ts`, because its `switch` throws on a kind it does not name (`:181` and `:182`).
- **`WorkflowName`** in `entities/workflow.ts` gains `'agent-loop'`. It belongs to no phase, like `assign`, `reap` and `supervise`. `PHASE_WORKFLOWS` does not list it, and `phaseOf` answers `null`. `workflow.test.ts` asserts that partition, so extend that test.
- **Two endings**, `blocked` and `checks-unanswered`, in `EndingReasonSchema` (`entities/ending.ts:75`). `endingIsAttributable` (`transitions/agent.ts:401`) admits actor `agent` for both. Its refusal sentence names every reason it admits. Extend the doc comment on actor `agent` to cover them.
- **`checksFromRuns`**, a new rule beside `checksVerdict` in `rules/checks-verdict.ts` or in its own file. It reads the `ShaRun | null` that `BuildPort.runForSha(branch, sha)` returns (`ports/build.ts`, `entities/build.ts`), the three-valued remote tip (`pushed` | `other` | `unknown`), the time waited and `Checks wait`. `checksVerdict` and its `ChecksReadings` do not change, because the shell loop calls them through `plot-checks-verdict.mjs` until slice 6.

### Decisions the plan settles — do not re-derive them

**The workflow keeps no state between passes.** Each pass derives where the agent stands from the readings: the manifest's assignment, the desk's `resetRefusals` (`rules/reapable.ts:534`), the prompt's exit (`PromptExit` in `rules/prompt-exit.ts`: `wait`, `end-limited`, `unstarted`, `ran`), the idle reading (`idleNow`, `rules/sample.ts:162`), the remote tip and the build run for the pushed commit. A loop state machine persisted to disk is the rejected alternative: `workflows/supervise.ts` keeps this property so that `kill -9` costs one pass, and `transitions/agent.ts` states the same for `AgentState`. A test asserts that no write carries a loop state.

**Reuse the write kinds that exist.** A marker is `blocked-marker` (`decision.ts:309`). A correction is `agent-resume` (`:234`). A start retry is `agent-attempt` (`:292`). The claim push and pushed work are `push` (`:355`). `commit` and `worker-signal` also stay as they are. A second kind for the same write is what `decision.ts` rules out. `assignment-clear` clears the manifest's `branch` field, as the shell's `clear_manifest_branch` does. `manifest-clear` (`:320`) deletes the manifest, and the loop never emits it.

**Every ending that waits for a person also emits `declaration` with `status: blocked`.** `supervise` reads the declaration file (`.plot-worker.envelope.json`, `DeclarationSchema` in `entities/declaration.ts`) and never the marker. With no declaration it answers `correct`, and a correction is the wrong answer to a question the agent asked. This applies to the `blocked`, `unstarted`, `limited` and `checks-unanswered` endings. `holding-work` emits no declaration: `the-shell-loop-holds-unlanded-work` decided that, and its correction tells the agent to land its work.

**Exit codes follow the table, and exit 0 is the fix for #1250.** The dispatch wrapper turns exit 0 into a `clear` line and any other exit into `gone`, and the board reads `gone` as "restart it". `blocked`, `holding-work` and `checks-unanswered` exit 0. `unstarted` and `limited` exit 1. `quiet`, `unreadable`, `bound`, `unregistered` and the end of a free wait exit 124. Carry the exit code in the `loop-end` write or in the decision's `detail`. Choose one, and say why in the PR.

**Five rows change today's behaviour, on purpose:** the agent-written marker, the spent budget, the unanswered wait, the moved tip and the unreadable tip. Today the shell loop goes free after each one, or exits `unstarted` 1 on a spent budget. The JS loop ends instead, so the slice stays with its desk. Do not "fix" a row to match the shell. The table's *Today* column describes the shell. It does not specify this slice.

**The tip comparison is equality, not ancestry.** `other` ends the wait with `checks-unanswered`, reason `tip-moved`, and the detail names the branch that moved. Reaching `Checks wait` ends it with reason `no-answer`. `unknown` keeps waiting inside `Checks wait`, because a failure to observe is not evidence. A connector that answers `unaskable` reads as `unknown` and never as "no CI answer". Equality is why no `plot-ancestry` declaration is needed. #1199 is the case: a person pushed `0e64fafd` on top of the agent's `f743e573`, and the build of `0e64fafd` belongs to that person. A `runForSha` answer whose `sha` is not the pushed commit is the fallback run (see the `runForSha` doc comment). It settles nothing.

**`no-answer` and `tip-moved` are a detail of `checks-unanswered`, not two endings.** If you model them as a `z.enum`, `scripts/check-state-declarations.sh` requires a `plot-state:` declaration within five lines above it. They are a classification, recorded once. The same applies to any other enum this slice adds. Add a `transitions/` rule only if the gate asks for one.

**Three counters stay apart.** `correctionAttempts` (the manifest field the shell raises with `raise_manifest_corrections`, `plot-worker-loop.sh:443`) counts corrections and is written by `correction-count`. The manifest's `attempts` counts start retries (`agent-attempt`) and supervisor relaunches (`MAX_ATTEMPTS` in `rules/supervision.ts:17`). Start retries and relaunches share `attempts` today, and that stays. Test both directions: a correction raises no `attempts`, and a start retry raises no `correctionAttempts`.

**Where a desk goes is not this slice's to change.** `deskState`, `deskLifecycle` (`rules/desk-lifecycle.ts`), `taskState` and `supervise` keep their rules. The test asserts their answers and does not edit them. If a row needs a different answer from one of them, report it with `PLOT-BLOCKED`.

**Rules carried over unchanged.** Absent is not false: a missing reading is `unknown`, never `no`. Read the answer, not the emptiness: an empty run list and `unaskable` are different answers (`BuildPort.runs` doc). Write arrow functions only (`export const f = (…) => …`, CLAUDE.md › The Domain Package). The domain imports only `zod` outside `adapters/` (the purity gate). TSDoc says what a function does and how it fails. The history goes into the commit message.

### Done when

The plan's slice 1 list is the specification. The slice is done when the domain coverage gate (100% lines, branches, functions and statements, `packages/domain/vitest.config.*`) passes over `agent-loop.ts` and the new rule.

Assertions that exist because a naive implementation passes without them:

- **`supervise`'s verdict for every row**, run through `supervise` itself (`workflows/supervise.ts:122`) on the readings that row leaves behind: `leave`, `needs-a-person`, `correct`, or `not asked`. Without this, a row can emit the right ending and no `declaration`, and `supervise` answers `correct` to a blocked agent. This is the main catch of the slice.
- **`deskLifecycle`'s exit for every desk a row can leave**: clean or dirty, and with or without a file-changing commit. An `unstarted` or `limited` ending on a fresh desk reads `refused-empty`, and its marker is copied and reaped. Assert that.
- **The spent-budget desk.** After at least one pushed correction, `markerRecordsWork` holds, so the desk is never reaped as empty.
- **The three-count test**, as above.
- **`taskState` and `deskState` for a desk with a PR and a marker.** The plan's open question says this reads `finished` on the agent side and `refused-with-work` on the desk side. Assert both, and change neither rule.
- **A moved tip with a green run for the new tip** still ends `checks-unanswered` (`tip-moved`). A rule that reads the newest run passes every other case.
- **`unknown` tip at `Checks wait`** ends `no-answer` and never `tip-moved`.
- **`endingIsAttributable`** admits actor `agent` for `blocked` and `checks-unanswered`, and still refuses it for `bound`, `quiet`, `unreadable` and `spent`.
- **`perform-fs`** skips each new kind and still throws on an unnamed kind.

Repo gates: before each push, run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. That covers the related domain tests, `tsc --noEmit` for the domain, the gate tests and the `scripts/check-*.sh` gates (here `check-state-declarations.sh` and `check-changeset-packages.sh`). The suites in the `CI suites` config key, including the domain coverage run, run in CI, and a failure there comes back as a correction. Do not run `pnpm run test:e2e` locally. `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file. If it does, remove at least as many shell lines in the same change. The gate has no override.

Add a changeset with package `plot` and the description first. Copy the format from `git log -p -- .changeset`.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work still moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to the `infra/the-loop-has-a-workflow` line under `## Slices` in the plan, on `main`.

### Scope guard

This branch owns:
- `packages/domain/src/workflows/agent-loop.ts` and its test (`packages/domain/test/workflows-agent-loop.test.ts`, following the `workflows-*.test.ts` naming)
- the new `Write` kinds in `workflows/decision.ts`, and their entries in `adapters/performer/perform-fs.ts`
- `'agent-loop'` in `entities/workflow.ts`
- the two endings in `entities/ending.ts` and their admission in `transitions/agent.ts`
- `checksFromRuns`, its readings type and its test
- the exports in `packages/domain/src/index.ts`
- the matching cases in `ending.test.ts`, `transitions-agent.test.ts`, `workflow.test.ts` and `performer-shell.test.ts`, which exercises the sandbox performer

It does not touch:
- `packages/board/**`: `performLoopWrites` and the ports are slice 2, and the entry is slice 3
- `skills/plot/scripts/**`
- `rules/desk-lifecycle.ts`, `rules/supervision.ts`, `workflows/supervise.ts` and `rules/checks-reading.ts`
- `checksVerdict`'s behaviour

Branches in flight, verified 2026-10-04: no PR was open in the repository. The only other remote branch is `infra/the-shell-loop-holds-unlanded-work`, which holds only its claim. It will touch `entities/ending.ts`, `transitions/agent.ts`, `ending.test.ts` and `transitions-agent.test.ts`, which is why this slice waits on its merge.

If you find something the plan did not anticipate, report it with `PLOT-BLOCKED` rather than improvising outside scope.
