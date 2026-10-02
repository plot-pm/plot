# An agent runs the tests its change touches

> A fleet agent runs only the checks its diff touches before it pushes, and CI runs the full suites. An agent keeps its slice until its PR's checks finish, so a failure CI finds comes back to it as a correction. Today every agent runs the repository's full suites on one machine, and seven agents doing so at once kept the load at 4-9 times the core count.

## Status

- **State:** Approved
- **Approved:** 2026-10-02, jwloka, in-session
- **Started:** 2026-10-02, Jan Wloka, `feature/a-slice-ends-when-its-checks-do`
- **Started:** 2026-10-02, Jan Wloka, `feature/the-checks-a-diff-needs`
- **Type:** feature
- **Sprint:** the-fleet-runs-through-its-limits
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- A fleet agent keeps its slice until its pull request's checks finish. A failed run reaches it as a correction, as a failed build already does while the agent is on the slice.
- A fleet agent runs the checks its change touches before it pushes, and CI runs every suite on every PR. A project declares those checks with the `Local checks` config key.
- `plot-local-checks.mjs` prints the checks for the current branch: the test files that name a changed file, the runners that follow imports from a changed file, and the checks a changed path's glob names.
- A project lists the suites only CI runs with the `CI suites` config key, and an agent at a fleet desk that starts one of them is refused, with the local checks command to run instead.

## Motivation

### Measured 2026-10-02 on this repository

These are single readings taken while the fleet ran, not a recorded series.

- The machine has 16 cores. With 7 and then 8 fleet agents, `uptime` read a 1-minute load between 55 and 148 from 01:00 to 02:35.
- At 02:33, six of seven agents were inside a test command and one was in a model turn: `pnpm run test:contracts` (two agents), `pnpm run test:coverage` (a package script), `node --test test/reconcile/workerstate.test.mjs`, a `node --test` run in `bug/a-delta-keeps-the-store-whole`, and a scan measurement in `bug/the-scan-time-is-measured`.
- The agents had run 1h17 to 1h45 and none had finished a slice.
- The agent on `bug/a-closed-pr-carries-no-branch` waited in a shell loop until the load fell below 14. The load did not fall below 55 in that hour.
- The board's scan timed out at 90 s in the same window.
- The cap went from 8 to 5 at about 02:35. A one-hour baseline from 02:55 records the 1-minute and 5-minute load and the running agent count every minute (`baseline-load-cap5.tsv`, summarised in Notes). It started at 7 agents, because agents above a lowered cap finish their slices.

### What an agent runs today

- The brief template ends its *Done when* section with *"Plus: <the repo's gates — test commands, build artifacts, changeset, platform constraints>"* (`skills/plot-implement/SKILL.md:239`). On this repository the brief agent fills it with the full list: `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board`, `pnpm run typecheck` (for example `.plot/briefs/the-loop-waits-out-a-usage-limit.md:70`).
- The shipped worker prompt says *"run the repo's gates, and never skip a failing test"* (`skills/plot/templates/worker-prompt.sh:186`). This repository's copy says *"Follow CLAUDE.md: … never skip tests"* (`.plot/worker-prompt.sh`), in the same sentence that orders `pnpm build:board`.
- The suites: `test:contracts` runs 115 files under a 1500 s bound (`package.json:19`). `test:board` builds the board, then runs 24 `node --test` files, 63 vitest integration files and 133 vitest unit files under a 1200 s bound (`package.json:18`). The domain package has 129 test files, and CI runs them with the coverage gate as `pnpm --filter @plot-pm/domain exec vitest run --coverage` (`ci.yml:884`); the root `package.json` has no `test:coverage`.
- CI runs all of them on every PR, so a full local run repeats CI's work on the shared machine.

### Where a CI failure goes today

- A failed build reaches its agent as a correction while the agent is still on the slice: the BuildMonitor publishes `build failed`, the loop writes `PLOT-CORRECTION.md` and resumes the session, bounded by `Correction budget` (2 here; `plot-worker-loop.sh:235-264`). This is `a-failed-gate-becomes-a-correction`, released in 2.17.0.
- After the agent leaves the slice, the same finding is `needsHuman` (`packages/domain/src/rules/attention.ts:113`, *"look at the failing run"*). Measured 2026-10-02: the agent on `bug/a-started-agent-leaves-its-starters-group` opened #1168, went free at about 02:35, took another slice in the same desk, and CI failed at 02:43. A person found and fixed the failure.
- Moving the suites to CI moves their failures into that gap. The first slice closes it.

### The precedent

`CLAUDE.md` already keeps `test:e2e` out of a local run for this reason: *"Nothing local depends on it passing. CI runs it on every PR … CI is the authority. An agent that runs it locally is paying the cost twice and starving everything else the second time."* That rule names one suite and is prose. This plan extends it to every suite a project declares, and makes the refusal a check at the desk.

## Design

### Approach

**Slice 1, an agent keeps its slice until its checks finish.** After a prompt ends, the loop calls `wait_for_checks` before it asks whether the build failed. It waits while the branch's head is on the remote, an open PR carries it, and the BuildMonitor has published no result for that head, up to `Checks wait` seconds (default 1800; `0` disables it). `checksVerdict` in `packages/domain/src/rules/checks-verdict.ts` decides, asked through `skills/plot/scripts/board/plot-checks-verdict.mjs` once a minute: one `node` start per minute per waiting agent, the cost `plot-prompt-exit.mjs` already pays once per prompt. The push and the PR are read once per finished prompt (one `git fetch` of the branch, one `plot-host.sh pr-state`). A failure then takes the existing correction path. **The BuildMonitor follows the desk's branch.** It read `PLOT_BRANCH` once at start, so for a free agent, which starts with none, it never asked the host and never published, and for an agent that hopped it reported the old branch. It now reads the desk's checked-out branch on every pass. The wait holds a fleet slot for the length of a CI run, about 10-15 min on this repository, which the PR body measures.

**Slice 2, the checks a diff needs.** `localChecks` in `packages/domain/src/rules/local-checks.ts` takes readings as values and returns the commands to run:

- *changed paths*: from `Refs.changedFiles` (`packages/domain/src/ports/refs.ts:121`, `refs-git.ts:178`), extended with the working tree's uncommitted and untracked paths;
- *generated paths*: the paths `.gitattributes` marks `-merge`, read the way `plot-deliverable-search.sh` reads them; a generated path never selects;
- *test references*: for each changed path, the test files that name its basename or its stem (`foo.ts` is also searched as `foo.js`, the form TypeScript imports use), searched only inside the globs the runners declare;
- *checks*: the `Local checks` config key, `glob = command` pairs separated by `;`. A command carries `{tests}` (the selected test files under that glob) or `{changed}` (the changed paths under that glob, for runners that follow imports, such as `vitest related`), or neither (a check that runs when any changed path matches the glob, such as a typecheck). `plot-config.sh` strips parentheses and normalises commas in every value, so a command uses neither;
- *limit*: `Local checks limit`, default 20. A changed path named by more test files than the limit selects none of them and is reported as *CI runs these N*.

A changed test file selects itself. A changed path that selects nothing is reported as *untested here — CI runs it*. The rule decides; it reads no file and spawns nothing. **Both placeholders are filled with absolute paths**, because a command such as `pnpm --filter <package> exec vitest related` runs in another directory: measured 2026-10-02, `vitest related` given a repo-relative path from there printed *No test files found* and exited 0, a pass that ran nothing.

This repository declares, in slice 2, one `Local checks` line: `node --test {tests}` for `test/reconcile/*.test.mjs`; `vitest related --run {changed}` and `tsc --noEmit` for the domain package; `vitest related --run {changed}` and `pnpm run typecheck` for the board's `src`; and, for any change (`**`), the gate tests `test/reconcile/*gate*.test.mjs` and the nine `scripts/check-*.sh` that CI runs as steps, 13 s together. `CI suites` lists `test:e2e`, `test:contracts`, `test:board`, the domain coverage run and `node --test test/reconcile/*.test.mjs`.

The board's 24 `node --test` files and 63 integration files start the built artifact, so no change under `src` selects them; they are CI's, by design, and slice 2 counts what that costs.

**The entry.** `packages/board/src/server/entry/local-checks.ts`, imported through the narrow path `@plot-pm/domain/rules/local-checks`, built by a `build.mjs` block like the panel's into `skills/plot/scripts/board/plot-local-checks.mjs`, with its `-merge` line in `.gitattributes` (gated by `scripts/check-bundle-attributes.sh`). It reads the readings through the `Refs` port and `Scripts` for the two config keys, prints one command per line, then a `summary:` line with the counts. Exit 0 always; 2 when not inside a git repository. The same bundle answers `ciSuiteRefusal` for slice 3 with a second verb. No new `plot-*.sh` script.

**Slice 3, a CI suite is refused at a desk.** `ciSuiteRefusal(command, suites)` in `packages/domain/src/rules/ci-suite.ts` returns a refusal when the command, after leading `VAR=value` assignments and `env` options are stripped, starts with a `CI suites` entry. It matches only the runner position, so a `grep`, a quoted commit message and a `gh pr create --body` that mention a suite pass. `plot-controller-gate.sh` gains an arm placed **before** its `named_script` exit and before its linked-worktree exemption. The arm runs only inside a linked worktree that holds `.plot-worker.pid` (a fleet desk). As a shell prefilter it also needs `PLOT_UNATTENDED=1` and one `CI suites` word in the command, so other Bash calls start no `node`. The refusal names the suite, says CI runs it, and prints the local checks command by a path relative to the gate script, which resolves under a plugin install. The gate runs from the plugin cache, so it reaches this fleet after a release and a plugin update. It is a check against habit, not a boundary: a command spelled another way passes, and the tests name the forms that do.

**The slices land in order, 1 to 4, each waiting on the one before**, so slice 4 merges only after the return route, the checks and the gate exist.

**Slice 4, agents run their local checks.** The brief template's gate line becomes *"Local checks: run `<plot scripts>/board/plot-local-checks.mjs` before each push and run what it prints. CI runs the suites in `CI suites`; a failure there comes back to you as a correction."*, where the brief agent writes the path resolved from the skill directory, as other skill-relative references are. Both worker prompts replace *"run the repo's gates"* and *"never skip tests"* with the same instruction, keep *"never skip a failing test"* (a selected test that fails is fixed, not skipped), and keep this repository's `pnpm build:board` order. The prompt's instruction wins over an older brief on main that still lists the suites. `CLAUDE.md`'s Testing section and `docs/definition-of-done.md` name the split.

### What this does NOT do

- It does not change CI. Every suite still runs on every PR, and a red CI run still blocks the merge.
- It does not lower the bar for a slice. A failure CI finds is fixed on the branch, by the same agent while the correction budget lasts.
- It does not choose checks for an adopting project. A project with no `Local checks` key gets only the *untested here* report, and one with no `CI suites` key is never refused.
- It does not raise the `Correction budget`. Slice 4's PR body counts corrections spent per slice before and after, and a change to the budget is a separate decision.
- It does not cap the fleet. The parallel-agents cap is a separate control, set to 5 on 2026-10-02.

### Open Points

- [ ] Slice 2's PR body counts, over the last 50 merged fleet PRs whose first CI run failed, the failures in a file the selection would not have chosen. Slice 4 does not merge if that share is above one in five.
- [ ] Slice 2's PR body reports how many changed paths hit `Local checks limit` over the last 20 merged PRs, and how long `vitest related` takes for a one-file change in each package.
- [ ] Slice 1's PR body measures how long an agent holds its slot waiting for checks, over at least five slices.

## Slices

### An agent keeps its slice until its checks finish (Branch: feature/a-slice-ends-when-its-checks-do, PR: #1171)

- `feature/a-slice-ends-when-its-checks-do` — `checksVerdict`, `plot-checks-verdict.mjs`, `wait_for_checks` in the loop, and the BuildMonitor reading the desk's branch on every pass <!-- builds: checksVerdict, the wait for a PR's checks -->

Tests:

- Domain: a PR whose head's checks are pending is not finished; a passing run finishes it; a failed run for the current head is a correction; a failed run for a superseded head is ignored; a PR with no terminal checks inside `Worker bound` finishes it and says so.
- `test/reconcile/`: a loop whose fake monitor publishes `build failed` for the pushed head writes `PLOT-CORRECTION.md` and resumes, instead of taking a new slice; a passing finding frees the agent.

### The checks a diff needs (Branch: feature/the-checks-a-diff-needs, PR: #1176) <!-- waits: feature/a-slice-ends-when-its-checks-do -->

- `feature/the-checks-a-diff-needs` — `localChecks`, the `Refs` working-tree extension, the `Local checks`, `Local checks limit` and `CI suites` keys, the entry and the `plot-local-checks.mjs` bundle, this repository's two config lines <!-- builds: localChecks, the checks a diff needs -->

Tests:

- `packages/domain/test/local-checks.test.ts`: a changed script selects every test file naming it inside the runner globs; a `.ts` change also matches its `.js` import form; a generated path selects nothing; a path above the limit reports *CI runs these* with the count; a changed test file selects itself; a `{changed}` runner receives the changed paths under its glob; a check with no placeholder runs once when its glob matches; no `Local checks` key selects nothing and reports every path untested.
- A contract test runs the bundle in a scratch repository with two commits and an uncommitted file, and checks the printed commands and the summary.
- The PR body carries the two measurements under Open Points.

### A CI suite is refused at a desk (Branch: feature/a-ci-suite-is-refused-at-a-desk) <!-- waits: feature/the-checks-a-diff-needs -->

- `feature/a-ci-suite-is-refused-at-a-desk` — `ciSuiteRefusal`, its bundle verb, and the arm in `plot-controller-gate.sh` <!-- builds: ciSuiteRefusal, the CI-suite gate arm -->

Tests:

- Domain: each `CI suites` entry is refused at the runner position, with and without `VAR=value` and `env -u NAME` prefixes; `grep test:contracts`, `git commit -m "… test:contracts …"` and `gh pr create --body "… test:board …"` pass; a suite not on the list passes; an empty key refuses nothing.
- `test/reconcile/`: the hook run from a linked worktree holding `.plot-worker.pid` exits 2 with the refusal for a listed suite; the same command from the main checkout exits 0; the same command at the desk without `PLOT_UNATTENDED=1` exits 0; a command naming a gated script still meets the existing controller refusal.

### Agents run their local checks (Branch: feature/agents-run-their-local-checks) <!-- waits: feature/a-ci-suite-is-refused-at-a-desk -->

- `feature/agents-run-their-local-checks` — the brief template line, both worker prompts, `CLAUDE.md` Testing, `docs/definition-of-done.md`

Tests:

- The unattended-shapes sweep still passes for `plot-implement`, and the prompt-template comparison in `test/reconcile/charter-reaches-launch.test.mjs` still passes.
- The PR body shows one brief written by the Brief command after this change, with the local checks line in place of the suite list, and the correction count named under *What this does NOT do*.

## Done when

- An agent whose PR's first CI run fails receives that failure as a correction on the same slice, and takes no new slice until the run passes or the budget is spent.
- `plot-local-checks.mjs` on a branch that changes one shell script prints the reconcile tests naming it and no typecheck; on a branch that changes one domain rule it prints the domain `vitest related` command and the domain typecheck; on a branch that changes only a generated bundle it prints nothing but the report.
- An agent at a fleet desk that runs `pnpm run test:contracts` is refused with the local checks command in the message; the same command in the main checkout runs.
- A brief written after slice 4 names the local checks command and no full suite.
- The share measured under Open Points is at most one in five before slice 4 merges.
- After slice 4 merges, one hour of the same sampling as the baseline, with 5 agents, is recorded in Notes beside the baseline before `/plot-deliver`.
- No new `plot-*.sh` script; every decision is in `packages/domain/src/rules/`.
- `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board`, `pnpm run typecheck` and the domain coverage gate pass in CI. Each slice carries a changeset.

## Notes

Written 2026-10-02 from the fleet run of sprint `the-fleet-runs-through-its-limits` (release 2.22.3), at the operator's request. The operator moved it into 2.22.3 the same night and asked for a panel before approval.

Panel round 1 (2026-10-02, three lenses: skeptic, operator, domain): unanimous `amend`. The moderation is `.plot/panels/2026-10-02-an-agent-runs-the-tests-its-change-touches/round1.md`. This version applies its nine amendments: corrected counts and the coverage command, a new first slice that keeps an agent on its slice until its checks finish, the `Refs` port instead of a new adapter, one `Local checks` key with per-glob checks, excluded generated paths and a limit, the named entry and bundle, the gate arm placed before both exits and decided at the desk, the slice order, and the load comparison against a recorded baseline.

The same evening the operator set the parallel-agents cap from 8 to 5 and set a model per role in `## Plot Config` (`1ccbbab4`): the Brief command on sonnet, the Idea, Story, Implement and Interrogate commands on opus.
