# Round 4 — cost

## What I read and ran

- Read: the plan at `547816537` in full, `round3.md`, `round3-cost.md`, the diff `9f53bb90e..547816537` of the plan.
- Read in code: `plot-worker-loop.sh:738-790` (`desk_reset_refusal`, `desk_hold_reason`) and `:1725-1800` (`head_is_pushed`, `wait_for_checks`); `rules/supervision.ts:190-330`; `workflows/supervise.ts:100-175`; `registryd-main.ts:84-100` and `:1040-1060`; `plot-config.sh:222-231`; `.github/workflows/ci.yml:300-330`; `package.json:19-20`.
- Ran: `git ls-remote --heads origin main` three times (0.39, 0.41, 0.41 s real); `gh api rate_limit` (core 0 of 5,000 used, GraphQL 33 of 5,000); `gh api orgs/plot-pm` (plan `free`); `gh run list` over 2026-10-03 (96 runs, 60 of them CI, peak 14 runs at once); `gh run view 37208059832` (validate 19 min 24 s, corpus 1 min 50 s); `ps` for loops, monitors and prompts; `git merge-base --is-ancestor` on the one live desk; `git grep` over the 30 loop test files for `Plot Config` and `PLOT_REPO_ROOT`; a count of file:line citations in the plan.
- Not run: any test suite, any fetch, anything that writes outside this file. One `git grep` that named `plot-dispatch.sh` was refused by the controller-gate hook; I did not read that file this round.

## Round-3 cost findings

1. **The prompt leaves the agent's process group: answered.** `runBounded` now starts the prompt without `detached`, kills the prompt's tree on the bound, on `SIGTERM` and on the loop's exit, and slice 3 adds a test that the `--stop` group kill ends both (#1084). Failure kind 5 now counts a prompt that outlives its loop. A loop killed by `SIGKILL` still leaves its prompt alive, and kind 5 is where that shows. That is the correct place for it.
2. **The baseline's source is deleted by the reaper: partly answered.** The plan now collects the baseline forward into `docs/notes/the-worker-loop-runs-in-js-baseline.md`. It names no collector. "Each day, the endings and log lines of the live desks ... and one `ps` reading" is a daily hand task for a window of unknown length (slice 1's merge to slice 4's merge), and each reading is a commit to `main` that no controller makes. A desk holds one `.plot-worker.ending.json`, and each loop end overwrites it, so a daily reading sees at most one ending per desk per day. Today one desk exists (`.worktrees/free-9172bc8c`). The `ps` reading also needs a start rule: right now `ps` shows 4 `plot-worker-monitor.sh` processes (pids 44095, 73324, 79168, 86172) with parent pid 1, alive 2 d 18 h, from the deleted desk `free-0be5680f`, running a script that no longer exists in the repository. A reading that counts processes started before the window charges them to the shell side. The fix: slice 1 appends each ending to one file outside the desk, so the count comes from a record and not a sample. The `ps` reading should count only processes that started inside the window.
3. **The CI leg has no time or ceiling: answered.** `loop-js` is its own job in parallel with `validate`, with `timeout-minutes: 20`, and slice 4's PR records its measured time. The reason given for the e2e files now matches the measurement (40 to 45 s). New finding 3 is about how the files run, not their time.
4. **The ratchet offsets are smaller than the additions: partly answered.** Slice 1 now gives a count (about 8 lines) and a fallback: if the PR cannot pay for both halves, the tip half moves to slice 4. That fallback removes the risk of a refused PR. Slice 1 still names no line that it removes. Slice 4 still says only "the body's dead or duplicated code" for a launcher of up to 4 lines. Nothing in the plan shows that such lines exist.
5. **The board has no coverage tool: answered.** Slice 4 adds `@vitest/coverage-v8`, a coverage block scoped to the entry file, and a CI step.

## New claims that do not hold

1. **Restart › "It runs its first restart check before its first pass, so a loop started from an older desk moves to main's bundle at once."** Condition 3 requires the main checkout's `HEAD` to contain "the commit the loop loaded from". A loop that starts on a claimed or continued desk loaded from that desk's `HEAD`, which is a slice-branch commit. This repository squash-merges, so main never contains that commit. I measured the one live desk: `.worktrees/free-9172bc8c` is at `83779b67e` on `bug/a-release-and-a-rejected-push-name-the-agent`, and `git merge-base --is-ancestor 83779b67e origin/main` answers no. A claim commit has the same problem (`plot: claim <branch>`, `plot-worker-loop.sh:51`). So condition 3 never holds for these loops, and they run their first bundle for their whole life. That is Motivation failure 5, the one the slice exists to fix. Only a loop that starts on a desk at a main commit can restart. The plan must define the loaded commit as the main-checkout commit whose bundle the loop pinned. For the first check it should drop condition 3 and compare only the hashes, under conditions 1 and 2.
2. **Slice 1 › "Each poll of `wait_for_checks` reads the branch's remote tip with one `git ls-remote`. A tip that differs from the pushed `HEAD` ends the wait."** The plan does not say what an unreadable tip does. A failed `ls-remote` prints nothing, and nothing differs from the pushed `HEAD`, so a network or auth failure ends the wait as `checks-unanswered`. Today one fetch per wait is exposed to that failure (`head_is_pushed`, `plot-worker-loop.sh:1732-1737`, "A fetch that fails reads as not pushed"). The new design reads once per poll: `PLOT_CHECKS_POLL_SECONDS` defaults to 60 (`:272`) and `Checks wait` is 3,600, so a wait has up to 60 readings. Each one costs 0.39 to 0.41 s and a round trip to the host. The `ls-remote` also runs in the foreground with no timeout, so a stalled connection holds the poll loop. The plan must state that an unreadable tip reads `unknown` and the poll continues, as it already states for the build connector, and the table test needs that row. The JS loop's `refs.remoteTip` needs the same answer.
3. **Costs › CI: "Each sandbox repository gets the key in its own `## Plot Config`, so `plot-config.sh` needs no environment override."** 10 of the 30 test files that name `plot-worker-loop` write no `Plot Config` at all: `test/e2e/worker-hops.test.mjs`, and `charter-reaches-launch`, `checks-wait`, `claim-prefix-gate`, `correction`, `ending`, `marker-writer`, `prompt-resolution`, `refused-slice-record` and `session-id` under `test/reconcile/`. `dispatch.test.mjs` alone writes it 28 times and `fleet.test.mjs` 14 times. The same file must write `shell` in `validate` and `js` in `loop-js`, so every file needs a switch between the two jobs. The plan removes the override from one script (`plot-config.sh`, which already honours `PLOT_REPO_ROOT` at `:222-223`) and spreads it over about 30 test files without naming the switch or counting the edits. Only `test/e2e/helpers.mjs` is a shared helper. `test/reconcile/` has none. The plan must name the switch (for example one variable that a shared helper reads when it writes a sandbox's config) and count the files that change in slice 4.
4. **Costs › CI: the third job's queue cost is not counted.** The `plot-pm` organisation is on the `free` plan (`gh api orgs/plot-pm`), which runs at most 20 jobs at once. On 2026-10-03, 96 workflow runs started and up to 14 ran at once. CI runs two jobs today (`corpus`, `validate`), and `loop-js` makes three. At the fleet's push rate the queue grows, and the queue time counts against each agent's `Checks wait` of 3,600 s. The plan must say whether `loop-js` runs on `push` as well as `pull_request`; running it on `pull_request` alone halves the added jobs. The slice-4 PR should record queue time beside run time.

## Which claims belong in the briefs

The plan cites 42 code locations as file:line, and 32 of them are in Design. Most of them are evidence for a decision that the plan states without them. The implementer re-checks them on the day of the slice in any case.

**Move to the slice briefs (an implementer checks them against that day's code):**
- Every `plot-worker-loop.sh:<line>` reference: `:2980-3000`, `:2486-2489`, `:2852-2856`, `:2327`, `:229`, `:2616`, `:2629`, `:399`, `:1751`, `:799`, `:738`. Keep the function names (`desk_reset_refusal`, `raise_manifest_attempts`, `wait_for_checks`) in the plan.
- The domain line references in Approach: `rules/task.ts:88`, `desk-lifecycle.ts:101-110`, `:158`, `:161-168`, `continue.ts:333`, `:446`, `agent-state.ts:132-143`, `transitions/agent.ts:401-415`, `entities/ending.ts:76-83`, `:96`, `ports/refs.ts:483`, `ports/performer.ts:12-15`, `rules/supervision.ts:203`.
- The "Starting point" column of the write table. The Write and Port columns stay.
- The "`agentState` / `deskState` after" column for every row except `holding-work`, `blocked` and the spent budget. The plan keeps the rule "the test asserts through the two rules, and a row they answer differently stops the branch". The brief carries the expected cells.
- Slice 4's seven source-text assertions by line (`workerloop.test.mjs:513,1269,1544` and the rest), and `deskreset.test.mjs:98-100`, `:118-124` in slice 1.
- Slice 7's removal list below the file level: `contract/schema.ts:3451`, `manifest-stamp.ts`, `registry.ts`, the `.gitignore` and `package.json` entries, and the README row. Keep the four removed files and the 1,120-line total.
- `plot-dispatch/SKILL.md:204`, `plot-release-gate.sh:30-33`, `docs/shell-and-domain.md:30`, `ci.yml:316`.

**Keep in the plan (a decision depends on them):**
- The decision and ending columns of the table, and the two endings that change (`bound` with a reason, and `blocked` exit 0 in place of `unstarted` exit 1). These are behaviour changes that adopting repositories see.
- The rule that the prompt stays in the agent's process group, with #1084 as its reason (the `--stop` path depends on it).
- The CI wait's equality rule, plus the unknown-tip rule from new finding 2.
- The index exception and its call count (180 an hour per waiting agent until slice 7, 60 after), because it is a declared exception to a repository rule.
- The four restart conditions as rules, with the corrected definition of the loaded commit (new finding 1), and the `process.execve` and Node-version decision.
- The `loop-js` job, its ceiling, its trigger, and its switch (new findings 3 and 4).
- The five failure kinds, the 20-slice threshold, and how the baseline is recorded.
- The Motivation measurements (891, 162, 39, 28 lines, and the five failures), which justify the plan.

## Anything that should stop the plan

No. Nothing found here makes the design wrong. Each finding is a missing rule or a missing count. Slice 1 still stands alone, as the open question says: it fixes a failure measured twice, and new finding 2 is its only cost-side defect.

## What holds

- The memory figures still hold. `plot-registryd.mjs` (pid 309) holds 63,952 KB after 2 d 08 h, against 60,656 KB in round 3, far below the 300 MB ceiling.
- The REST budget has room: core `0 of 5,000` used at this reading, and `git ls-remote` spends no REST budget.
- No loop and no BuildMonitor is orphaned at this moment. The 4 orphans are worker monitors from a script that the repository already removed, which supports the Motivation's claim that a monitor outlives its wrapper.
- The registry daemon applies only `agent-assign` and `worker-start` (`registryd-main.ts:1047-1052`). Its `correct` verdict for a `holding-work` desk, with no declaration and commits ahead (`supervision.ts:309-320`, `madeProgress`), therefore starts no prompt. So the plan's claim that exit 0 costs no relaunch holds in practice as well as in the exit code.
- The prompt runs without `PLOT_REPO_ROOT` (`workerloop.test.mjs:1380-1388`), so a fleet agent's tests do not read this repository's `Worker loop` value. The JS loop must keep that test green, and the `loop-js` job runs it.
- The main checkout's bundle paths are clean and tracked (`git status --porcelain -- skills/plot/scripts/board/` prints nothing, and 40 files are tracked), so restart conditions 1, 2 and 4 can be read cheaply.

Position: amend
