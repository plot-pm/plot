# An agent runs the tests its change touches

> A fleet agent runs only the checks its diff touches before it pushes, and CI runs the full suites. Today every agent runs the repository's full suites on one machine, and seven agents doing so at once keep the load at 4-9 times the core count.

## Status

- **State:** Draft
- **Type:** feature
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A fleet agent runs the checks its change touches before it pushes: the test files that name a changed file, and the typecheck where TypeScript changed. CI still runs every suite on every PR.
- `node skills/plot/scripts/board/plot-local-checks.mjs` prints those checks for the current branch.
- A project declares which suites run only in CI with the `CI suites` config key, and an unattended agent that starts one of them is refused with the targeted checks to run instead.

## Motivation

### Measured 2026-10-02 on this repository

- The machine has 16 cores. With 7 and then 8 fleet agents, the 1-minute load average stayed between 55 and 148 from 01:00 to 02:35.
- At 02:33, six of seven agents were inside a test command and one was in a model turn: `pnpm run test:contracts` (two agents), `pnpm run test:coverage`, `node --test test/reconcile/workerstate.test.mjs`, a `node --test` run in `bug/a-delta-keeps-the-store-whole`, and a scan measurement in `bug/the-scan-time-is-measured`.
- The agents had run 1h17 to 1h45 and none had finished a slice.
- The agent on `bug/a-closed-pr-carries-no-branch` waited in a shell loop until the load fell below 14. The load did not fall below 55 in that hour.
- The board's own scan timed out at 90 s in the same window (`Last scan failed: timed out after 90000ms`).

### What an agent runs today

- The brief template ends its *Done when* section with *"Plus: <the repo's gates — test commands, build artifacts, changeset, platform constraints>"* (`skills/plot-implement/SKILL.md:239`). On this repository the brief agent fills it with the full list: `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board`, `pnpm run typecheck` (for example `.plot/briefs/the-loop-waits-out-a-usage-limit.md:70`).
- The shipped worker prompt says *"run the repo's gates, and never skip a failing test"* (`skills/plot/templates/worker-prompt.sh:186`). This repository's copy says *"Follow CLAUDE.md: … never skip tests"* (`.plot/worker-prompt.sh`).
- The suites are large: `test:contracts` runs 115 files under a 1500 s bound, `test:board` builds the board and runs 24 integration files and 133 unit files under a 1200 s bound, and the domain package has 129 test files with a coverage gate (`package.json:18-19`, `packages/domain/package.json:23-24`).
- CI runs all of them on every PR (`.github/workflows/ci.yml`), so a full local run repeats CI's work on the shared machine.

### The precedent

`CLAUDE.md` already keeps `test:e2e` out of a local run for this reason: *"Nothing local depends on it passing. CI runs it on every PR … CI is the authority. An agent that runs it locally is paying the cost twice and starving everything else the second time."* That rule names one suite and is prose. This plan extends it to every suite a project declares, and makes the refusal a gate.

## Design

### Approach

**Slice 1, the rule.** `localChecks` in `packages/domain/src/rules/local-checks.ts` takes readings as values and returns the commands to run:

- *changed paths*: the files the branch changes against its base, from `git diff --name-only <base>...HEAD` plus uncommitted and untracked paths;
- *test references*: for each changed path, the test files that name its basename, read with one `git grep -l -F` per basename over the test globs;
- *runners*: a list of `glob = command` pairs from the new `Test runners` config key, for example `**/*.test.mjs = node --test {files}` and `packages/domain/test/**/*.test.ts = pnpm --filter @plot-pm/domain exec vitest run {files}`;
- *typecheck*: the `Typecheck command` config key, run when any changed path ends in `.ts` or `.tsx`.

A changed test file selects itself. A changed path that no test file names selects nothing and is reported as *untested here — CI runs it*, so a reader sees the gap instead of a silent pass. A runner whose glob matches no selected file is left out. The rule decides; the adapter only reads git.

**The entry.** `skills/plot/scripts/board/plot-local-checks.mjs`, a bundle like `plot-panel.mjs`, reads the three readings through a `local-checks` adapter (git and the two config keys) and prints one command per line, then a `summary:` line with the counts. Exit 0 always, 2 when it is not inside a git repository. No new `plot-*.sh` script.

**Slice 2, the brief and the prompt.** The brief template's gate line becomes *"Local checks: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. Do not run the suites in `CI suites`; CI runs them."* The shipped `skills/plot/templates/worker-prompt.sh` and this repository's `.plot/worker-prompt.sh` replace *"run the repo's gates"* and *"never skip tests"* with the same instruction. *"Never skip a failing test"* stays: a selected test that fails is fixed, not skipped. `CLAUDE.md`'s Testing section and `docs/definition-of-done.md` name the split: local checks before a push, the full suites in CI.

**Slice 3, the gate.** A new `CI suites` config key lists the commands only CI runs. This repository declares `test:e2e, test:contracts, test:board, test:coverage`. `ciSuiteRefusal(command, suites, unattended)` in `packages/domain/src/rules/` returns the refusal for a command that runs one of them. `plot-controller-gate.sh`, which already matches commands against a list, gains one arm that asks the rule through a bundle verb. The gate refuses only under `PLOT_UNATTENDED=1`: a person running a suite at the terminal is not stopped. The refusal names the suite, says CI runs it, and prints the local checks command.

### What this does NOT do

- It does not change CI. Every suite still runs on every PR, and a red CI run still blocks the merge.
- It does not lower the bar for a slice. A failure CI finds is fixed on the branch, as today.
- It does not choose suites for an adopting project. A project with no `CI suites` key keeps today's behaviour, and one with no `Test runners` key gets the typecheck and the *untested here* report only.
- It does not cap the fleet. The parallel-agents cap is a separate control, set to 5 on 2026-10-02.

### Open Points

- [ ] How many CI failures a full local run would have caught first. Slice 1's PR body counts, over the last 50 merged fleet PRs, the ones whose first CI run failed in a file the targeted selection would not have chosen.
- [ ] A basename match over-selects a common name such as `index.ts` and under-selects a module reached only through a re-export. Slice 1 reports both counts for this repository's last 20 merged PRs.
- [ ] Bundled artifacts under `skills/plot/scripts/board/` change on every board change. The rule treats a changed bundle as selecting the tests that name it, which may be many; slice 1 measures it.

## Slices

### The checks a diff needs (Branch: feature/the-checks-a-diff-needs)

- `feature/the-checks-a-diff-needs` — `localChecks`, the `local-checks` adapter, the `Test runners` and `Typecheck command` keys, and the `plot-local-checks.mjs` bundle <!-- builds: localChecks, the checks a diff needs -->

Tests:

- `packages/domain/test/local-checks.test.ts`: a changed script selects every test file naming it; a changed test file selects itself; a path no test names is reported untested and selects nothing; a `.ts` change adds the typecheck and a `.sh`-only change does not; a runner whose glob matches nothing is left out; no `Test runners` key selects no tests.
- A contract test runs the bundle in a scratch repository with two commits and checks the printed commands and the summary.
- The PR body carries the three measurements named under Open Points.

### Agents run their local checks (Branch: feature/agents-run-their-local-checks) <!-- waits: feature/the-checks-a-diff-needs -->

- `feature/agents-run-their-local-checks` — the brief template line, both worker prompts, `CLAUDE.md` Testing, `docs/definition-of-done.md`

Tests:

- The unattended-shapes sweep still passes for `plot-implement`.
- The PR body shows one slice brief written by the Brief command after this change, with the local checks line in place of the suite list.

### A CI suite is refused in an unattended run (Branch: feature/a-ci-suite-is-refused-unattended) <!-- waits: feature/the-checks-a-diff-needs -->

- `feature/a-ci-suite-is-refused-unattended` — the `CI suites` key, `ciSuiteRefusal`, the gate arm in `plot-controller-gate.sh` <!-- builds: ciSuiteRefusal, the CI-suite gate arm -->

Tests:

- `packages/domain/test/ci-suite-refusal.test.ts`: `pnpm run test:contracts` is refused under unattended; the same command attended passes; a suite not on the list passes; `pnpm run test:contracts -- --help` is still refused; an empty key refuses nothing.
- `test/reconcile/` gate test: the hook exits 2 with the refusal text for a listed suite under `PLOT_UNATTENDED=1`, and 0 without it.

## Done when

- `node skills/plot/scripts/board/plot-local-checks.mjs` on a branch that changes one shell script prints the reconcile tests naming it and no typecheck, and on a branch that changes one domain rule prints that rule's tests and the typecheck.
- A brief written after slice 2 names the local checks command and no full suite.
- An unattended agent that runs `pnpm run test:contracts` is refused by the gate with the local checks command in the message.
- Over one hour with 5 agents, the 1-minute load average on this machine stays below 32 (twice the core count), measured in slice 2's PR body with `uptime` every 60 s.
- No new `plot-*.sh` script; every decision is in `packages/domain/src/rules/`.
- `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board`, `pnpm run typecheck` and the domain coverage gate pass in CI. Each slice carries a changeset.

## Notes

Written 2026-10-02 from the fleet run of sprint `the-fleet-runs-through-its-limits` (release 2.22.3), at the operator's request, for the sprint after it. It is not part of 2.22.3.

The same evening the operator set the parallel-agents cap from 8 to 5 and set a model per role in `## Plot Config` (`1ccbbab4`): the Brief command on sonnet, the Idea, Story, Implement and Interrogate commands and implementation on opus.
