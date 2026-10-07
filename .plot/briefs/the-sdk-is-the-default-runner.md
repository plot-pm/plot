## Implementation brief — fleet-agents-run-through-the-agent-sdk (wave 5: The SDK is the default runner)

- **Plan (canonical):** `docs/plans/2026-10-05-fleet-agents-run-through-the-agent-sdk.md` on `main`
- **Approved:** 2026-10-05, jwloka, in-session
- **Branch:** `infra/the-sdk-is-the-default-runner` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review)

All three waits have merged: `infra/js-is-the-default-loop` (#1330), `infra/a-run-records-its-spend` (#1326) and `infra/the-board-commands-run-through-the-port` (#1331). This is the last wave of the plan. `infra/board-roles-after-the-port` is a bug branch on `origin` that touches the port's command adapter; see the scope guard.

### What to build

**The failure it fixes.** Measured 2026-10-05 from the transcripts under `~/.claude/projects/`: the fleet ran sessions of 384 turns at 454k peak context, and waiting turns were 11% to 18% of 394M weighted tokens. Waves 1 to 4 built the SDK runner, its records and its limits, behind `Agent runner`, with the default `command`. Nothing yet measures whether the SDK runner costs less than the cap-only `command` runner (`CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000`, c172910a8), so nothing licenses making it the default. This wave builds the measurement and the flip, and the flip waits for the measurement.

What lands:

1. **`scripts/count-fleet-turns.mjs`**, read-only, modelled on `scripts/count-master-diagnosis.mjs` (same transcript scope rules: the main checkout's Claude Code project directory, fleet sessions only, never a master session). Per day and per runner it reports the four columns of the plan's Motivation table (fleet sessions, turns per session, mean peak context, weighted tokens; a cache read counts 1/10), plus weighted tokens per sealed slice, turns per run, completed polls and refused polls. A **refused poll** is a tool call whose result carries `plot: poll refused`; every other polling call is **completed**. It classifies `true`, `sleep`, task-output `cat`, `ps`, `ScheduleWakeup`, `ListAgents` and CI reads. It takes its windows as arguments and derives nothing about which slices were delivered; the sealed slices come from the slice-spend record (a `command` slice has its seal line, an SDK slice has run lines).
2. **The comparison the bar needs**, as output of the script: per size group (diff of at most 200 changed lines, more than 200), the count of slices and the median weighted tokens per sealed slice on each runner, the SDK median as a share of the baseline's, the SDK window's completed polls, and each side's share of slices that end at a person. It names the slices it counted on both sides.
3. **The flip**, `defaultsToSdkWhenNamed: true` at the three call sites that pass `false` today: `packages/board/src/server/board.ts:382`, `packages/board/src/server/runner-gate.ts:21` and `packages/board/src/server/entry/worker-loop.ts:1728`. `runnerChoice` (`packages/domain/src/rules/runner-choice.ts`) already answers `sdk` for an absent `Agent runner` where the project names `claude` for the role, and its tests already cover the flip; do not rewrite the rule. Update the `Agent-runner keys` comment in `skills/plot/scripts/plot-config.sh` to say the default, and `skills/plot-dispatch/SKILL.md` if its prompt check still says the default is `command`.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**The flip is conditional on a measured bar, and the bar is not met at brief time.** Measured 2026-10-07 at brief time: this repository's `## Plot Config` has no `Agent runner` key, so no slice has run on `sdk` and the SDK window is empty. The plan's bar needs the next 20 or more sealed slices on `sdk`, after an operator commit that sets `- **Agent runner:** sdk` (slice 2's operator step). That commit is **not** yours to make: it is a person's decision about when the fleet's spend moves runner. Therefore:

- Build item 1 and 2 first, and run the script over the `command` baseline window (below) so its output is real. Put the baseline figures in the PR.
- Make item 3 **only if** the script shows every condition of the bar holds. If the SDK window has fewer than 20 sealed slices, or fewer than 5 per size group on either side, **do not flip**: open the PR with items 1 and 2, state the SDK window's size, and record in the PR that the flip waits on the operator step and on the window. Report that rather than lowering the bar, shrinking the groups or choosing a smaller window to make it pass. The bar is a measurement, and adjusting it to pass is the one move forbidden.
- Never write `Agent runner: sdk` into `CLAUDE.md` yourself, and never fake an SDK window with fixture slices in the real report.

**The bar, as the plan states it.** The flip holds when all of these are true:

- The baseline is the sealed `command` slices of this repository on the JS loop (`Worker loop: js`) between the later of c172910a8 (the 200k cap) and the merge of `infra/js-is-the-default-loop` (bbfa4f2a1, 2026-10-07T09:06:43+02:00), and the commit that sets `Agent runner: sdk`, at least 20 slices. Both windows run the JS loop under the cap, so the runner is the only change between them.
- In each of two size groups, with at least 5 slices per group on each side, the median weighted tokens per sealed slice on `sdk` is at most 85% of the baseline's.
- The SDK window shows 0 completed polls.
- The share of SDK slices that end at a person is at most the baseline's share.

The median peak context is reported and is not a condition, because `autoCompactWindow` sets it. A baseline window that opens at bbfa4f2a1 is short; if it holds fewer than 20 sealed slices, say so, and the script reports that the baseline is too small instead of an answer.

**The baseline is the cap-only `command` runner, not the pre-cap one.** Comparing against the uncapped days (2026-10-02 to 2026-10-04) credits the SDK with the saving the 200k cap already makes. The plan claims no saving the cap makes.

**The default derives from what the project wrote, never from `PATH`.** A role reads `sdk` only where the project already names `claude` for it (a board role's first command word, after `NAME=value` prefixes; the worker's loop is `js` and its charter's harness is `claude` or unstated). A project on another harness keeps `command` with no config edit. Do not add a check that `claude` is installed.

**Slice 5 owns the per-run turn distribution.** The 150 `Agent max turns` default is set from per-session means (Open Questions). The script reports turns per run on the SDK runner. If it shows the default is wrong, change the default in this PR with the figure beside the change; if the SDK window is empty, leave it open and say so.

**Carried over from related work, unchanged:**

- Absent is not false. A run with no run line (a `command` run) has no cost figure; the script reports it as not measured, never as zero spend.
- A weighted token counts a cache read as 1/10 of a token; the four-key token contract of `TokenCountsSchema` is not extended.
- Read a transcript's tool results, not the emptiness of its output: a refused poll is the text `plot: poll refused` in a result, and a poll with an empty result is a completed one.
- Duplication is allowed and undeclared duplication is not: if the script re-implements a classifier the domain holds (a polling shape, a seal rule), import it through a bundle or declare the duplicate with a comparison test.
- Do not run a transcript reader over a worker's worktree directory: it is a near-empty project directory. Pass the main checkout's path, as `count-master-diagnosis.mjs` does.

### Done when

The plan's `## Done When`, **Slice 5**, is the specification:

- `scripts/count-fleet-turns.mjs` reports, per day and per runner, the four columns of Motivation's table, weighted tokens per sealed slice, turns per run, completed polls and refused polls, and classifies `true`, `sleep`, task-output `cat`, `ps`, `ScheduleWakeup`, `ListAgents` and CI reads.
- The default flips when the four conditions of the bar hold, and the PR names the slices it counted on both sides and the figures. **Where they do not hold, the PR ships the script without the flip and says which condition fails.** That is a complete delivery of this branch's first half, not a failure of it.

Assertions that exist because a naive implementation would pass without them:

- **A refused poll is not a completed poll.** A fixture transcript with one `true` call whose result carries `plot: poll refused` and one whose result is empty reports 1 refused and 1 completed. Catches a classifier that counts every `true` as completed (the SDK window then never reads 0) or every empty result as refused.
- **A `sleep`, a task-output `cat`, a `ps`, a `ScheduleWakeup`, a `ListAgents` and a CI read each fall in their own class,** and a `cat` of an ordinary source file is not a poll. Catches a `cat` regex that counts every read.
- **A master session (`entrypoint: "cli"`) in the fixture directory is not counted.** Catches the 250M-token figure charged to the operator's own sessions.
- **A slice whose sessions straddle the runner switch counts once, under the runner of its newest run,** or the script names it as straddling; it is not counted on both sides. Catches a baseline that holds a slice the SDK window also holds.
- **The 85% condition is evaluated per size group,** and a fixture where the pooled median passes while one group fails reports the flip as not met. Catches a pooled median that hides a large-diff regression.
- **A group with fewer than 5 slices on either side reports `too few`, not a ratio.** Catches an answer computed from 2 slices.
- **An empty SDK window reports `no SDK window`, not 0 completed polls.** Catches the third condition passing on no data. The same for an absent baseline.
- **The three flipped call sites agree.** A test asserts `runnerChoice` answers `sdk` for an absent `Agent runner` with `claude` named, and `command` for `gemini -p`, through each of the three readings, so one site left at `false` fails. (Only if the flip is made.)

Plus the repo's gates. Run `nvm use` first (Node 24; `pnpm` crashes on 26) and `pnpm install` if `node_modules` is missing. Before each push run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e`.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. Comment lines in `plot-config.sh` count. If the slice touches a `.sh` file, pay for any growth in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override.

Do not run `pnpm build:board` into a commit: a PR's diff carries no generated bundle (`scripts/check-no-bundle-diff.sh`); build only to test, then restore the generated paths. On a conflict in `board-server.mjs` follow Definition of Done › Resolving a board artifact conflict. A new script gets a row in `skills/plot/scripts/README.md` only if it lives under `skills/plot/scripts/`; `scripts/count-fleet-turns.mjs` lives in `scripts/`, so check what `scripts/check-helper-table.sh` and `scripts/check-script-names.sh` require of it and run both.

A new function you write is an arrow, in the script and in any test helper.

A **changeset** is required: `.changeset/*.md` with the description FIRST (20 characters at least) and the `bumps:` block LAST, package `plot`, with a `plan:` line inside the same comment block. If the flip lands, name the user-visible default change (a role runs on the SDK where the project names `claude` and the loop is `js`); if only the script lands, say it measures both runners. Run `./scripts/check-changeset-packages.sh`. Do not edit `metadata.version` by hand.

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while the work moves
```

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`. Push the first real commit as soon as it exists.

The PR body names the slices counted on both sides, the figures for each condition of the bar, the per-run turn distribution if an SDK window exists, and whether the flip landed. If it did not, the PR says what the operator does next: commit `- **Agent runner:** sdk` to `## Plot Config`, let 20 or more slices seal, and re-run the script.

### Scope guard

This branch owns:

- `scripts/count-fleet-turns.mjs` and its test
- the three `defaultsToSdkWhenNamed` call sites named above, only if the bar holds
- the `Agent-runner keys` comment group in `skills/plot/scripts/plot-config.sh` (comment lines only) and the `Agent runner` wording in `skills/plot-dispatch/SKILL.md`
- `.changeset/`

**Do not touch:** `CLAUDE.md`'s `## Plot Config` (the operator sets `Agent runner`), `runnerChoice` and its rule tests (they already cover the flip), the SDK adapter, the run-line schema and `readSpend` (wave 3), the board routes (wave 4), and `Agent max spend`, `Slice max spend` and `Slice max runs` defaults. If the data shows one of them is wrong, report it.

**One branch is in flight and it overlaps you.** `bug/board-roles-after-the-port` (verified with `git diff --stat origin/main...origin/bug/board-roles-after-the-port` at brief time) changes `packages/board/src/server/board-run.ts`, `entry/main.ts`, `packages/domain/src/adapters/agent-run/agent-run-command.ts` and their tests. It does not touch the three call sites above. If it merges first, rebase onto `main` before you open the PR. The `defaultsToSdkWhenNamed` sites sit in `board.ts`, `runner-gate.ts` and `entry/worker-loop.ts`; keep the edit to the one line in each.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
