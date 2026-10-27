## Implementation brief — bundle-entries-exit-before-stdout-drains (wave 1: Entries)

- **Plan (canonical):** `docs/plans/2026-10-27-bundle-entries-exit-before-stdout-drains.md` on `main`
- **Approved:** 2026-10-27, Jan Wloka, plan-PR #2748 merged
- **Branch:** `feature/bundle-entries-end-through-a-drain` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `Review: pr` — one full review per PR; findings without a HIGH follow up after the merge

This is the plan's only branch. Nothing waits on it and it waits on nothing.

### What to build

An entry bundle that writes more than 64 KB and then calls `process.exit()` loses the rest of its output on a pipe. Measured 2026-10-27: `plot-ask.mjs board` writes 595,679 bytes to a file and 65,536 bytes through a pipe, exit 0. `plot-ask.mjs fleet` writes about 150 KB to a file, 65,536 through a pipe, and `jq -e .` fails with `Unfinished JSON term at EOF at line 1, column 65536`. The master agent reads both through a pipe. Your change fixes it when `plot-ask.mjs fleet` through a pipe returns the full byte count and parses.

Build three parts:

1. `packages/domain/src/adapters/entry-exit.ts` exports one arrow, `endEntry(code)`. It writes an empty chunk to stdout with a callback, then an empty chunk to stderr with a callback, then calls `process.exit(code)`. An `EPIPE` on either stream calls `process.exit(code)` at once, so a reader that closes early does not change the code. It returns a promise that never settles, so `await endEntry(code)` stops an async flow.
2. Every one of the 66 `process.exit(` lines in 59 files under `packages/*/src/server/entry/` ends through `endEntry`. `listing-walk.ts:79` and `registryd-main.ts:2914` already end without `process.exit`; they also end through `endEntry`.
3. `scripts/check-entry-exit.sh` refuses any `process.exit` token on a non-comment line of a file under `packages/*/src/server/entry/`. It has zero allowed sites, no allow-list and no ratchet.

The plan is canonical. This brief is orientation.

### Settled decisions — do not re-derive them

**A bare `process.exitCode = code` is not the fix.** Measured: `plot-ask.mjs fleet` completes its answer at 2.3 s and, with `exitCode`, lives until 17.6 s. It starts 41 more child processes after the answer, including paid host calls (`plot-host.sh runs`, `issue-list`, `spend-rate`, `account`). `plot-ask.mjs board` lives from 10.2 s to 18.1 s and starts 23 more. The board controller's background work owns those handles and the entry cannot close them. Also, `exitCode = 4` with 1 MB written to `head -c 10` exits 1 with an unhandled `EPIPE` stack trace, where `process.exit(4)` exits 4.

**`process.stdout.write('', () => process.exit(code))` is the mechanism.** It delivered 1,000,000 bytes to `wc -c` and to a slow reader, exited 4 at once with a live `setInterval`, and kept status 4 with `head -c 10`. Do not replace it with `once('drain')` or `setTimeout`.

**The helper lives in the domain's `adapters/`, not in a board or fleet shared directory.** It reaches the process, and the layering rule puts that in an adapter. Board and fleet entries both already import `@plot-pm/domain/adapters/*` (`dispatch-command.ts:4-6`), so one module serves both packages. The purity gate allows it under `adapters/`. Do not add the file to `entry/`: the gate would refuse it.

**A static token ban is exact, a call-graph gate is not.** "Follows a stdout write" cannot be decided by text, because most entries write inside `run` through a callback. With every entry ending through a helper outside `entry/`, zero tokens is the right bound. Operator decision, panel round 1. Do not add a ratchet or an allow-list.

**The four control-flow exits fall through if you only swap the call.** `transition.ts:352` falls into `run(...)` at `:368` and writes a second answer. `local-checks.ts:217` falls into the usage error at `:221-222` and turns exit 0 into `EXIT.usage`. Rewrite these four (`transition.ts:352`, `local-checks.ts:214,217,219`) and the three early refusals (`plan-for-branch.ts:47`, `transition.ts:364`, `review-bypass.ts:148`) as `if/else` chains in which exactly one branch reaches `endEntry`, with `local-checks.ts:222` as the final `else`. Keep each branch's exit code and stdout as today. `await endEntry(...)` never returns, but do not rely on that for a sync `run` path: write the chain so it is correct without it.

**Out of scope, left unchanged:** `registryd-main.ts:2060`, `:2917` and `worker-loop.ts:2003` exit through an injected process object on signal and start-failure paths that write no answer. The gate does not see them and that is stated in the plan. `board/src/server/index.ts:1020`, `lifetime.ts`, `fleet/src/shared/board-run.ts:72` and the two domain adapters are server lifetime paths, not entries. The open question about `plot-ask.mjs` background work stays open; the helper keeps that work cut off as `process.exit` does today.

**Carried-over rules.** Absent is not false. Read the exit code, not the emptiness. A function you write is an arrow, in the domain and in the board files and tests you touch. Do not rewrite a neighbouring `function` declaration. TSDoc on `endEntry` states what it does, its parameters and how it fails, and carries no history; the reasoning goes in the commit message.

### Done when

The plan's `### Acceptance` list and `### Tests` section are the specification. Assertions that exist because a naive implementation passes without them:

- **A 1 MB real-pipe test on a built entry bundle.** It asserts the full byte count and the exit code. 200 KB is a race on Linux (19 to 25 of 30 runs cut) and does not catch the defect reliably; 1 MB cuts in 30 of 30 on Linux and macOS. Without it, a helper that merely calls `process.exit` in a callback passes.
- **`plot-ask.mjs fleet` ends within a stated bound after its last byte.** It catches the bare-`exitCode` ending (2.3 s answer, 17.6 s exit). Pick the bound from a measured run and name it in the test.
- **Helper unit test:** a stubbed asynchronous stdout shows `process.exit` is called only after both callbacks fire, with the right code; `EPIPE` on stdout still gives `process.exit(4)`; code after `await endEntry(...)` does not run.
- **Control-flow tests** per branch of `transition.ts`, `local-checks.ts`, `plan-for-branch.ts` and `review-bypass.ts`, each asserting exit code and exact stdout. `local-checks` with no arguments exits with its run's code and prints no usage line.
- **Gate contract test** `test/reconcile/entry-exit-gate.test.mjs` (matches the existing `*gate*` glob): refuses a tail `process.exit(run(...))`, refuses `.then((c) => process.exit(c))`, ignores a comment line, ignores a file outside `entry/`, passes on the repository tree. Run a mutation pass: remove the comment filter, then widen the path; the test must fail each time. Commit before you mutate, and restore from git.
- `./scripts/check-entry-exit.sh` passes on your branch and names 66 sites on `origin/main`. Prove the second half in a pristine `main` worktree.

Plus these repo gates:

- Add `&& ./scripts/check-entry-exit.sh` to the `Local checks` `**` line in `CLAUDE.md`, run `./scripts/check-agents-md.sh --write`, and add one step to `.github/workflows/ci.yml`.
- The script uses `grep -a` (the NUL-byte precedent) and holds to bash 3.2 syntax; `scripts/check-bash32-syntax.sh` scans `scripts/`.
- One changeset for package `plot`: the description is the plan's Changelog line, first; the `bumps:` block is last; add a `plan:` line inside the block. Run `./scripts/check-changeset-packages.sh`.
- Run `pnpm build:board` locally to test, then commit no generated bundle (`scripts/check-no-bundle-diff.sh`). Main rebuilds after merge.
- Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `pnpm run test:e2e` locally.
- `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice adds no shell under `skills/`; if you touch a `.sh` file there, remove shell elsewhere in the same change or write the rule in the domain. The gate stores no number and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). Do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. Commit messages use `plot: <description>`.

### Scope guard

This branch owns: `packages/domain/src/adapters/entry-exit.ts` and its test, the files under `packages/board/src/server/entry/` and `packages/fleet/src/server/entry/` that contain `process.exit(`, `listing-walk.ts`, `registryd-main.ts`'s ending, `scripts/check-entry-exit.sh`, `test/reconcile/entry-exit-gate.test.mjs`, the `CLAUDE.md` `Local checks` line with the regenerated `AGENTS.md`, `.github/workflows/ci.yml` (one step), and one changeset. Verified at dispatch: no other branch of this plan exists, and `git log` shows no change to any `entry/` file since the plan was approved. Other plans' branches may touch entry files; rebase on `main` before the final push and re-run `grep -rn 'process\.exit(' packages/*/src/server/entry/`, because a file added since this brief counts as a site.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
