## Implementation brief — a-refused-start-is-retried-and-named (wave 2: Brief retry)

- **Plan (canonical):** `docs/plans/2026-11-21-a-refused-start-is-retried-and-named.md` on `main`
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3614 merged
- **Branch:** `bug/a-refused-brief-is-asked-again` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

Wave 1 (`bug/the-brief-ask-test-owns-its-clock`, #3620) merged 2026-11-21 14:21Z, so the test file is yours. Waves 3 to 5 wait on this branch.

### What to build

A brief run that ends without a brief must be asked once more, and a second such end must stop the asking and show on the board. Today it is asked never again (#3134): `maybeAutoDispatch` skips every branch in `briefsAsked` (`packages/fleet/src/shared/auto-dispatch.ts:453`) and marks every started ask (`:470`), and `outstandingAsks` (`packages/domain/src/rules/brief-budget.ts`) drops an asked branch only when its brief lands, when it leaves the candidates, or when a usage-limit reset passes. Measured on origin/main: `jenkins-sha-runs-build-status-fails` (approval commit `abedcfb49` at 2026-11-03 16:33:41Z, brief run 16:34Z read no approved plan) and `plot-fleetctl-stop-ignores-dry-run` (`ac8f8edd4`, 2026-11-04 18:08:38Z, run read the plan as Draft) were both still `held on no-brief` hours later.

The cause is two readings of two trees. The pass reads the plan as Approved on `origin/<main>` (`findMissingBriefs` reads git), and the run reads the main checkout's working tree, because `askForBrief` runs in `tree: opts.repoRoot` and `/plot-implement` step 1 parses `docs/plans/*.md` there. Only an operator's fetch and merge moves that tree. So the slice does two things: the prompt pins the `origin/<main>` commit and the run reads the plan at that commit, and one retry stays as the backstop for every other refusal.

The plan's `### Approach › Brief retry` section is canonical; this is orientation.

### Settled decisions — do not re-derive them

**Pin the commit, and read it synchronously.** `maybeAutoDispatch` is synchronous, so it reads the sha of `origin/<main>` once per pass through a synchronous `Refs` read, not through an awaited port. `briefAskPrompt` (`brief-ask.ts`) gains a `sha` argument: `/plot-implement <slug> --at <sha> — write the hand-off brief …`. An unread sha starts no ask that pass. A keyed-on-new-plan-commit retry would not fire: the plan file did not change after either measured refusal.

**`/plot-implement --at <sha>`** goes in `skills/plot-implement/SKILL.md` beside `--branch`. Step 1 reads the plan at `<sha>` (`git cat-file -e <sha>` first, then `git show <sha>:<plan file>`) and runs its phase test on that text, as `--branch` already reads `origin/<name>`. The changeset bumps `plot-implement: minor`. Update the skill's Model Guidance table if a step changes, and the skill README.

**`onEnd` fires for every end with no `resetEpoch`, and for no other path.** A usage-limit end keeps its wait path through `onLimit` and spends no retry. A start that returned `''`, a start that threw, and a `refused` runner choice call neither, and their branch stays marked as today (`auto-dispatch.ts:466-469`): a broken command must not start a process per pulse. Dropping that mark was the obvious fix and it starts one process per pulse.

**The rules are domain properties, not pass logic.** `brief-budget.ts` gains `BRIEF_ASK_RETRIES = 1`, `briefAskState(branch, readings)` answering `asked` (run live or waiting for a reset), `free` (never asked, or ended with retries left) or `spent` (ended `BRIEF_ASK_RETRIES + 1` times, brief still missing), and `outstandingEnds(ends, missingBriefs)`, which keeps the end count of each branch still in `missingBriefs`, as `outstandingWaits` does for waits. `outstandingAsks` takes the end counts as a fourth input and keeps only `asked` branches, so a `spent` branch no longer charges the `Parallel agents` cap through `briefAskBudget`. Arrow functions, TSDoc that states behaviour and not history.

**A successful end is not a second ask, and it is bounded.** A run that pushed its brief also calls `onEnd`. A pulse taken before the push lands reads the branch `free` with one end and asks once more; the second run finds the brief on `origin/<main>` and ends without a write. That costs at most one extra run and never a third, and a test pins it.

**State survives a restart through a file.** fleetd writes `.plot/state/brief-spent/<branch slug>.json` (`{ branch, slug, ends, log }`) when a branch turns `spent`, removes it when `outstandingEnds` drops the branch, and reads the files at start, so a restart does not reset the bound. The implement route removes the file for its branch before it starts a brief, so a person's Write brief clears the hold. The spent log line prints once per daemon life.

**The board shows it, and never hides it.** `BriefReading` (`packages/board/src/server/brief-ask-log.ts`) gains `spent: { ends: number; log: string } | null`. `BRIEF_WRITER_STATES` (`packages/domain/src/rules/brief-writer.ts`) becomes `['writing', 'spent', 'failed', 'asked', 'none']`, `spent` after `writing` and before `failed`. `AgentRow` in `packages/board/src/contract/schema.ts` gains `briefSpent`, and `briefNote` (`packages/board/src/app/lib/agent-rows/row-identity.ts`) reads "brief run ended 2 times without a brief" with the log path beside the existing Write brief action. The action stays enabled: a person's click clears the hold (No hidden UI).

**Carried-over rules.** Absent is not false: a branch missing from `missingBriefs` because the read failed is not a landed brief; keep `findMissingBriefs`' answer as the only source. A view state is a domain property: the row's note wording comes from the domain state, not a decision in `.tsx`.

### Done when

The plan's `## Slices` line for this branch is the specification, and `### Approach › Brief retry › Unit tests` lists the cases. Assertions that exist because a naive implementation would pass without them:

- **The `@reads-plan-at` stub.** It runs `git show <sha>:<plan>` and writes the brief only for `State: Approved`. A working tree holding `Draft` and an `origin/main` holding `Approved` must get its brief on the first ask. Without it the test asserts the prompt text and proves nothing about the tree the run reads.
- **The `@ends-briefless` stub** (exit 0, no brief). A refused run is asked again on the next pass, a second refused run is not asked a third time, the spent line logs once, and the spent file is written. It catches a retry that never stops.
- **At most one more ask after a successful run read as missing.** Catches a retry that counts a landed brief as a refusal.
- **A usage-limit end still waits and spends no retry; a spawn failure and a `refused` runner choice stay marked.** Catches `onEnd` firing on the wrong paths.
- **`spent` is not counted by `briefAskBudget`**, and a spent file reads as `spent` in `brief-ask-log.test.ts`.
- **A restart keeps the bound** (the file read at start).

Tests: `packages/domain/test/brief-budget.test.ts`, `packages/domain/test/brief-writer.test.ts` (each order cell with `spent`), `packages/board/test/unit/auto-dispatch-brief-ask.test.ts`, `packages/board/test/unit/brief-ask-log.test.ts`.

Plus: a changeset (package `@plot-pm/board`, description first and the `bumps:` block last, with `plot-implement: minor`; the gate refuses a bare comment-open first line and a description under 20 characters); the board `Board impact` comment in the plan already covers the contract. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. Do not run board tests while the operator's board is open. Run `pnpm build:board` only to test locally and commit no bundle (`scripts/check-no-bundle-diff.sh`). Run `./scripts/check-agents-md.sh --write` only if you edit `CLAUDE.md`.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches no `.sh` file, so it has nothing to charge. If you find you must touch one, growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines, and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while moving), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

You own: `packages/domain/src/rules/brief-budget.ts` and `brief-writer.ts`; `packages/fleet/src/shared/brief-ask.ts`, `auto-dispatch.ts` and `auto-writes.ts`; fleetd's spent-file read at start; `packages/board/src/server/brief-ask-log.ts`, the implement route's file removal, `packages/board/src/contract/schema.ts`, `row-identity.ts`; `skills/plot-implement/SKILL.md` and README; their tests; one changeset. In flight on the same plan, not started: `bug/a-start-refusal-names-its-defect` (`start-command.ts`, `plot-dispatch.sh`, `performer-shell.ts`), `bug/the-probe-and-the-loop-name-the-charter-prompt` (`write-probe-shell.ts`, `registryd-main.ts`, `worker-loop.ts`) and `bug/a-red-pr-is-re-run-once-per-head` (`slice-pr-next.ts`, fixer files). Leave those files alone. Also in flight outside this plan: `bug/the-brief-ask-names-its-branch` has a brief on `origin/main` and touches the brief ask; read `git log origin/main -- packages/fleet/src/shared/brief-ask.ts` before you start and rebase on what has merged. If you find something the plan did not anticipate, report it rather than improvising outside scope.
