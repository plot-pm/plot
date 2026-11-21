# A refused start is retried and named

> fleetd asks again for a brief whose run ended without one, a `--start` refusal names its own defect, the write probe and the worker loop name the prompt a charter declares, and a red slice PR gets one CI re-run per head before a fixer starts.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #3134, #3141, #3125
- **Review:** pr
- **Impl:** own branches

## Changelog

- fleetd asks again for a hand-off brief when the brief run ends and no brief reached the default branch, at most once more per branch, so a brief that refused on a plan its checkout still read as Draft no longer holds the slice at `no-brief` until a restart.
- `plot-dispatch.sh --start` names the defect of each refusal in its summary footer (`worker=no-loop`, `worker=charter-refused` or `worker=prompt-absent`) and prints the `--restart` hint only where a branch dispatch repairs the refusal.
- A charter that the prompt resolution refuses now refuses at `--start` on the `sdk` runner too, before a desk is cut.
- The write probe tests the prompt file that the worker loop sources for the configured agent, and names that file in its answer.
- The worker loop's refusal for a missing prompt file names the file and the charter that declares it, as `--start` does.
- fleetd re-runs the failed CI jobs of an open PR once per head before it starts a CI-red fixer on that head.

<!-- Board impact: Brief retry changes fleetd's auto-dispatch pass (packages/fleet, packages/domain) and the board's auto-dispatch test. Start refusal and Probe and loop change the start rule (packages/domain), the start-command and write-probe entries (packages/board/src/server/entry), plot-dispatch.sh and the worker loop (packages/fleet). CI re-run changes fleetd's fixer pass and the fixer attempts record. No plan format, template, docs/plans layout or rendered board state changes. A builder runs `pnpm build:board` locally to test and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one. -->

## Motivation

**A refused brief is never asked again (#3134).** `maybeAutoDispatch` skips every branch in `briefsAsked` (`packages/fleet/src/shared/auto-dispatch.ts:453`) and marks every started ask (`:470`). `outstandingAsks` (`packages/domain/src/rules/brief-budget.ts:34-46`) drops an asked branch only when its brief lands on `origin/<main>`, when it leaves the candidates, or when a usage-limit reset passes. A brief run that ends without a brief therefore holds its branch until fleetd or the board restarts. `askForBrief` already receives the run's end (`packages/fleet/src/shared/brief-ask.ts:168-172`) and passes only `resetEpoch` on. Measured on origin/main:

- `jenkins-sha-runs-build-status-fails`: the approval commit `abedcfb49` landed at 2026-11-03 16:33:41Z, and the brief run started at 16:34Z, read no approved plan and refused. The slice was still `held on no-brief` at 2026-11-04 18:24Z.
- `plot-fleetctl-stop-ignores-dry-run`: the approval commit `ac8f8edd4` landed at 2026-11-04 18:08:38Z, and the brief run started at 18:10Z, read the plan as Draft and refused. The slice was still `held on no-brief` at 18:24Z.

In both cases the pass that asked read the plan as Approved on `origin/<main>`, and the brief run read an older copy less than two minutes later. The plan file on `origin/<main>` did not change after the refusal, so a retry keyed on a new plan commit would not fire; a retry keyed on the run's end does.

**A `--start` refusal names one defect for all (#3141).** `plot-dispatch.sh` prints `worker=no-loop` and the hint `A branch dispatch (--restart <branch>) starts a worker on any command.` for every `refused` answer of `startCommand` (`skills/plot/scripts/plot-dispatch.sh:2128-2134`). Only the not-the-loop refusal (`packages/domain/src/rules/start-command.ts:89-93`) has that defect and that repair; the charter refusal (`:98-99`) and the absent-prompt refusal (`:102-109`) print the same footer and a hint that repairs neither. The performer reads that footer word as `unaskable` (`packages/domain/src/adapters/performer/performer-shell.ts:112`).

- `if (runner !== 'command') return null;` (`start-command.ts:97`) runs before the `refused` check (`:98`), so a refused charter on `Agent runner: sdk` passes `--start`, a desk is cut, and the worker loop refuses later (`packages/fleet/src/server/entry/worker-loop.ts:1648-1650` refuses a refused charter on either runner).
- The board entry's header says "It reads stdin, spawns nothing and opens nothing" (`packages/board/src/server/entry/start-command.ts:34`), and the entry reads the charter with `readFileSync` (`:60`) and the prompt file with `existsSync` (`:90`).
- `readNamedCharter` (`start-command.ts:56-65`) copies `read` from `packages/fleet/src/server/entry/prompt.ts:58-69`: ENOENT gives `absent`, any other error `unreadable`. If the two drift, `--start` and the loop disagree about one charter.
- The write probe joins only `FALLBACK_PROMPT` to the repo root (`packages/domain/src/adapters/write-probe/write-probe-shell.ts:86-87`), while the loop launches the prompt that `resolvePrompt` (`packages/domain/src/rules/prompt.ts:40-43`) answers for a declared charter. The probe tests a file a chartered agent never sources.
- The loop's absent-prompt refusal always says `run plot-install-prompt.sh to write .plot/worker-prompt.sh` (`worker-loop.ts:1654`). For a charter that declares `.plot/prompts/x.sh`, the installer writes the fallback and the declared file stays missing. `missingPrompt` already gives the right repair: `write <path>, which charter '<name>' names` (`start-command.ts:107`).
- The charter-refusal tests check exit 1 and no runs (`packages/fleet/test/unit/worker-loop-run.test.ts:374-380`) or no requests (`packages/fleet/test/unit/worker-loop-sdk.test.ts:444-450`), and neither asserts `calls.attempts`. Reverting the no-retry part of the refusal leaves both green.

**Two remaining parts of #3125.**

- `packages/board/test/unit/auto-dispatch-brief-ask.test.ts:513` and `:552` assert `toBeGreaterThan(nowEpoch())` against the wall clock, while the stub prints `resets 11pm (Europe/Berlin)` (`:111`). `resolveReset` resolves a reset up to `PAST_RESET_GRACE_SECONDS` (120 s) in the past to now (`packages/domain/src/rules/prompt-exit.ts:124,258-261`), so between 23:00:00 and 23:02:00 Berlin time the recorded epoch equals now and the strict `>` fails. CI run 42117422301 failed on main at `87d93b8ae` with `expected 1793916015 to be greater than 1793916015`; 1793916015 is 2026-11-05 23:00:15 CET.
- fleetd has no re-run of a failed CI run on a slice PR. The only `rerunFailed` caller is the main-repair arm (`packages/fleet/src/shared/repair-start.ts:137`). On 2026-11-04 PR #3110 was red from 01:31Z to 18:05Z and #3111 from 10:24Z to 18:05Z on one flaky test; on each, the fixer spent both CI attempts, pushed nothing, and named a re-run as the next step for a person.

## Design

### Approach

**Brief retry: a brief ask that ended is asked again (#3134):**

- **The end reaches the pass.** `askForBrief` gains an `onEnd` callback, called from the end handler (`brief-ask.ts:168-172`) for every end that carries no `resetEpoch`. A usage-limit end keeps its wait path through `onLimit`. A start that returned `''` or threw calls neither, and its branch stays marked as today (`auto-dispatch.ts:466-469`), because a broken command must not start a process per pulse.
- **The rule is a domain property.** `brief-budget.ts` gains `BRIEF_ASK_RETRIES = 1` and `briefAskState(branch, readings)`, which answers `asked` (a run is live or waits for a reset), `free` (never asked, or its run ended with retries left), or `spent` (its run ended `BRIEF_ASK_RETRIES + 1` times with the brief still missing). `outstandingAsks` takes the ended counts as a fourth input and keeps only `asked` branches, so a `spent` branch no longer charges the `Parallel agents` cap through `briefAskBudget`.
- **The pass.** `maybeAutoDispatch` takes `briefEnds: Map<string, number>` beside `briefWaits`, and `packages/fleet/src/shared/auto-writes.ts:90` holds it across passes as it holds the other two. An end drops the branch from `briefsAsked` and adds one to its count. The skip at `auto-dispatch.ts:453` reads `briefAskState`: a `spent` branch is skipped and logged once per daemon life as `auto-dispatch: ${slug}'s brief run ended ${n} times without a brief for ${branch} — log: ${log}; a person restarts it with /plot-implement`. A landed brief or a branch that leaves the candidates drops its count, as `outstandingWaits` drops a wait.
- **Unit tests** in `packages/domain/test/brief-budget.test.ts`: an ended ask with retries left is `free`; a second end is `spent`; a `spent` branch is not counted by `briefAskBudget`; a live ask is `asked`; a wait before its reset is `asked`; a landed brief drops the count. In `packages/board/test/unit/auto-dispatch-brief-ask.test.ts`, with a new `@ends-briefless` stub that exits 0 and writes no brief: a refused run is asked again on the next pass; a second refused run is not asked a third time and logs the spent line once; a usage-limit end still waits for its reset and spends no retry; a spawn failure stays marked.

**Start refusal: a start refusal names its defect (#3141, part a):**

- **The refusal carries a word.** `StartCommand`'s `refused` arm gains `defect: 'no-loop' | 'charter-refused' | 'prompt-absent'` (`start-command.ts:57`). The not-the-loop arm answers `no-loop`, the charter refusal `charter-refused`, and the absent file `prompt-absent`.
- **The charter refusal comes first.** `missingPrompt` checks `resolution.resolve === 'refused'` before the runner gate, so a refused charter refuses on both runners, and the `@param prompt` doc (`start-command.ts:68-70`) states that order. The `sdk` runner is still never refused for an absent file.
- **The entry prints the word.** `packages/board/src/server/entry/start-command.ts` adds the word to its `refused` answer. Its header states what it reads: stdin, the named charter file and the existence of the resolved prompt file. It calls `read` from `packages/fleet/src/server/entry/prompt.ts` in place of `readNamedCharter`, so one charter reader serves both the start check and the loop.
- **The shell prints the word.** `ask_start_command` (`plot-dispatch.sh:1002-1021`) reads the word, and the `refused)` branch (`:2128-2134`) prints `worker=${start_cmd_defect}` and prints the `--restart` hint only for `no-loop`. The edit adds no shell lines net, so `scripts/check-shell-lines.sh` passes.
- **The performer reads every word.** `performer-shell.ts:112` matches `worker=(no-loop|charter-refused|prompt-absent)` and still answers `unaskable` for each.
- **Tests:** `packages/domain/test/start-command.test.ts`, one cell per `defect`, and a refused charter on the `sdk` runner refuses with `charter-refused`; `packages/board/test/unit/start-command-entry.test.ts`, the entry's answer carries the word, and an unreadable charter file reads `unreadable` through the shared reader; `packages/domain/test/performer-shell.test.ts`, each footer word reads `unaskable`; `test/reconcile/dispatch.test.mjs`, an absent prompt prints `worker=prompt-absent` and no `--restart` hint, and the not-the-loop refusal prints `worker=no-loop` with the hint.

**Probe and loop: the probe and the loop name the charter's prompt (#3141, part b):**

- **The probe resolves as the loop does.** `WriteProbeShellOptions` gains `prompt: () => { file: string; charter: string | null } | { refused: string }`. The two callers, `packages/board/src/server/entry/write-probe.ts:58` and `packages/fleet/src/server/entry/registryd-main.ts:3283`, build it from `read` and `resolvePrompt` for the agent that `PLOT_AGENT` names, the input the loop reads (`worker-loop.ts:2754`). `check` probes that file in place of `FALLBACK_PROMPT` (`write-probe-shell.ts:86`), answers `unaskable` with the charter's reason for a refused charter, and names the probed file in every `unaskable` reason.
- **The loop names the declared file.** `worker-loop.ts:1654` reads the resolution's verb and charter name from the line it already splits (`:1636`): for `declared`, the refusal says `the prompt file <file> is absent; write <file>, which charter '<name>' names`; for `fallback`, the text stays.
- **The tests pin the no-retry rule.** `worker-loop-run.test.ts:374-380` and `worker-loop-sdk.test.ts:444-450` assert `calls.attempts` equal `[]`.
- **Tests:** `packages/domain/test/write-probe-shell.test.ts`, a declared charter's prompt is probed and the fallback is not read, a refused charter answers `unaskable` with its reason, and an absent declared file names that file; `worker-loop-run.test.ts`, a declared charter with an absent prompt logs the `write <file>, which charter '<name>' names` repair; both charter-refusal tests fail when a retry is restored.

**Test clock: the brief-ask test owns its clock (#3125):**

- The `@limited` stub (`auto-dispatch-brief-ask.test.ts:107-113`) prints a reset time that the fixture computes from one clock reading taken when it writes the stub: the hour two hours after that reading, in `Europe/Berlin`. The fixture returns the expected reset epoch beside the stub.
- `RECORDS THE RESET EPOCH` (`:505-515`) and `A SECOND WAIT REPLACES THE EPOCH` (`:543-553`) assert the recorded epoch equals the expected epoch, and no assertion reads `Date.now()` after the ask.
- Proof: the two cases pass with the fixture's clock reading pinned to 23:00:15 Europe/Berlin, the instant that failed in run 42117422301.

**CI re-run: a red PR is re-run once per head (#3125):**

- **Consistent with the fixer plan.** `docs/plans/2026-11-20-the-fleet-fixes-every-red-or-conflicting-pr.md` replaced the fixer's arm walk with `fixerPrNext` (`packages/domain/src/rules/slice-pr-next.ts:516-535`, merged in #3600) and adds `conflictArm` before `ciRedArm` in `feature/the-fixer-merges-the-base-into-a-conflicting-pr` (#3603, open). The CI re-run slice adds `ciRerunArm` to that walk after `conflictArm` and before `ciRedArm`: GitHub runs no `pull_request` checks for a conflicting merge ref, so a re-run there is useless. It edits `slice-pr-next.ts`, `auto-fixer.ts` and `entities/fixer-attempts.ts`, which #3603 also edits, so it waits on that branch.
- **The arm.** `ciRerunArm` answers `{ step: 'rerun', head }` where the row's `ciChecks` reads `failing` on `checksSha === headSha`, the CI-red budget is not spent, the desk is gone by the same test `ciRedArm` uses (`slice-pr-next.ts:320-321`), and the attempts record holds no re-run for this head. It answers `none` with `rerun-asked` where a re-run for this head is recorded, so `ciRedArm` then starts a fixer on a second red, and `none` with `no-ci-red` otherwise.
- **The record.** `FixerAttemptsRecordSchema` gains an optional `reruns: { headSha, at, answer: 'asked' | 'unaskable' }[]`. `FIXER_ATTEMPTS_VERSION` stays 1, as in the conflict slice: an older build reads a record with the new field as unreadable, and an unreadable record holds every fixer on that PR. A re-run spends no fixer attempt.
- **The tick.** `FixerTickWorld` gains `build: Pick<BuildPort, 'rerunFailed'>`. On a `rerun` step `fixerTick` writes the re-run record first, then calls `rerunFailed(row.head, head)` (`packages/domain/src/ports/build.ts:144`). An `unaskable` answer (Jenkins, `build-jenkins.ts:215`, or no build, `build-none.ts:36`) is recorded as `unaskable`, so the next pass goes on to the fixer and never asks again for that head. A failed call writes `answer: 'asked'` all the same, so a host that refuses never gets a second re-run for one head. The run log names each re-run with the PR, the head and the answer.
- **The fixer brief.** `fixerPrompt` for CI-red evidence states that the failed jobs were re-run once on this head and failed again, so the fixer does not report a re-run as its next step.
- **Bitbucket.** Its rows carry no `ciChecks`, so the arm never fires there, as `ciRedArm` does not.
- **Tests:** in `packages/domain/test/slice-pr-next.test.ts`, each `ciRerunArm` answer; a first red on a head answers `rerun`; a second red on the same head answers the `fixer` step; a new head answers `rerun` again; a spent CI budget holds; a conflicting row answers the conflict arm first. In `packages/domain/test/fixer-attempts.test.ts`, the schema round-trips `reruns`. In `packages/fleet/test/unit/auto-fixer.test.ts`, a `rerun` step calls `rerunFailed` once with the branch and head and writes the record before the call; an `unaskable` answer is recorded and the next tick starts the fixer; a second tick on the same head makes no second call.

### Open Questions

- [ ] Is one retry (`BRIEF_ASK_RETRIES = 1`) enough? Both measured refusals came from a checkout that lagged `origin/<main>` by under two minutes, and the next pass runs seconds after the first run ends. An alternative is that the brief prompt names the `origin/<main>` commit the pass read, and `/plot-implement` reads the plan at that commit, so the lag cannot refuse at all.
- [ ] Does the re-run arm fire on every first CI red per head, or only where the failing job touches no file of the PR's diff? The first costs one CI round before a genuine failure reaches a fixer; the second needs a per-job file reading that the PR index does not hold.
- [ ] Does a re-run also fire on a PR whose desk agent is alive? This plan keeps the desk test of `ciRedArm`, so a live desk agent keeps its own CI correction and spends a correction on a flake.

## Slices

### Test clock

- `bug/the-brief-ask-test-owns-its-clock` — the `@limited` stub's reset computed from the fixture's clock reading, and exact epoch assertions in the two usage-limit cases <!-- builds: a clocked usage-limit stub for the brief-ask test -->

### Brief retry

- `bug/a-refused-brief-is-asked-again` — `onEnd` from `askForBrief`, `briefAskState` with `BRIEF_ASK_RETRIES`, `briefEnds` held across passes, a spent branch skipped, logged once and not charged against the cap, and the domain and board tests <!-- builds: briefAskState, the brief ask's asked/free/spent state -->

### Start refusal

- `bug/a-start-refusal-names-its-defect` — the `defect` word on `StartCommand`'s refusal, the charter refusal before the runner gate, the entry's header and the shared charter reader, the shell footer and hint per word, the performer reading every word, and the tests <!-- builds: StartCommand.defect, the refusal's footer word -->

### Probe and loop

- `bug/the-probe-and-the-loop-name-the-charter-prompt` — the write probe resolving the configured agent's prompt and naming it, the loop's repair naming a declared file and its charter, and `calls.attempts` in both charter-refusal tests <!-- builds: the write probe's prompt resolver -->

### CI re-run

- `bug/a-red-pr-is-re-run-once-per-head` — `ciRerunArm` between `conflictArm` and `ciRedArm`, the `reruns` field on the fixer attempts record, the tick's `rerunFailed` call with its `unaskable` path, the fixer brief's re-run line, and the tests <!-- builds: ciRerunArm, one CI re-run per head before a fixer --> <!-- waits: feature/the-fixer-scope-reads-every-open-pr, feature/the-fixer-merges-the-base-into-a-conflicting-pr -->

## Notes

- Created 2026-11-21 from triaged issues #3134, #3141 and #3125. Every file:line above was read on origin/main `b21961602`.
- **Left out of #3125, already fixed:** the `scan-writes-bridge.test.ts` "KILLED" timeout, fixed by `f33dabb0d` (*the killed-scan test kills at a known point in the walk*) and `79bdc4302` (*the killed-scan test holds the bridge write on a FIFO*); the `release-finish-real-repo.test.ts` commit failures, fixed by `df45ce66c` (*git never guesses a committer email inside a test run*).
- **Changed from the issue's wording:** #3125 asks for a re-run after the fixer reports a failure as unrelated. This plan re-runs before the fixer starts, so a flake costs one re-run and no agent. A second red on the same head starts the fixer, and the existing CI-red budget of 2 then hands the PR to a person; the PR index carries no run id, so the record keys the re-run by head rather than by run id.
- `plot-plan-meta.sh` reads each `###` heading as one slice, and `sliceVerdicts` (`packages/domain/src/rules/eligible.ts:166-169`) makes a slice eligible only after every slice above it is complete. The slices therefore run in plan order: the test clock first, because its flake turns main red, and the CI re-run last, because it also waits on #3603.
- `feature/the-fixer-scope-reads-every-open-pr` merged as #3600; the CI re-run slice names it in `waits:` as the brief asks, and the wait is already met. `feature/the-fixer-merges-the-base-into-a-conflicting-pr` is #3603, open on 2026-11-21.
- #3141's file:line references are older than origin/main; this plan cites the current lines. `plot-fleetctl.sh`'s probe note now sits at `:1111`, not `:1141-1142`.
- `plot-deliverable-search.sh` results: `outstandingAsks` exists only in `brief-budget.ts` and `auto-dispatch.ts`, and nothing named `briefAskState`, a brief retry or a brief end count exists; `startCommand` has no defect word; `readNamedCharter` exists only in the board entry; no write-probe prompt resolver exists; `rerunFailed` has adapters (`build-shell.ts:201`, `build-jenkins.ts:216`, `build-none.ts:36`, `build-actions.ts:132`, `build-fixture.ts:91`) and its one caller is `repair-start.ts:137`; nothing named `ciRerunArm` exists; no clocked usage-limit stub exists.
