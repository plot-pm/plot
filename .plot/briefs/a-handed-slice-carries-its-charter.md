## Implementation brief — the-fleet-loop-reads-its-runs-right (wave 3: A handed slice carries its charter)

- **Plan (canonical):** `docs/plans/2026-10-07-the-fleet-loop-reads-its-runs-right.md` on `main`
- **Approved:** 2026-10-07, jwloka, in-session
- **Branch:** `bug/a-handed-slice-carries-its-charter` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is the third wave of four. It waits on waves 1 (#1353) and 2 (#1360), both merged. Wave 4 (`bug/a-waiting-run-needs-approval-again`) waits on it.

### What to build

The JS loop reads the agent charter once, at start, from `PLOT_AGENT`: `runnerDeps` calls `readAgentCharter(input.repoRoot, input.agent)` (`packages/board/src/server/entry/worker-loop.ts:1762`), and `main` passes `agent: env.PLOT_AGENT ?? ''` twice (`:2039`, `:2063`). A free agent that is handed a slice later therefore runs the start-time charter's prompt file, model, effort and window, not the charter the slice names (#1169). A second defect is in the same slice: the board writes `.plot-worker.continue.md` (`CONTINUATION_NAME`, `packages/board/src/server/continue.ts:66`). The file is not in `.gitignore` and `plot-desk-dirt.sh:102` does not excuse it, so a merged desk that holds only that file reads dirty and `plot-reap.sh` never reaps it (#1166).

Three changes:

1. **Resolve the charter at take-up.** When the loop takes up a slice, it resolves that slice's `agent:` charter through `rules/prompt.ts` (`resolvePrompt`, `resolveLaunch`) and runs the prompt with that charter's prompt file, harness, model and effort. A slice with no `agent:` annotation keeps the start-time values. `runPrompt` already calls `(deps.resolvePrompt ?? promptAnswer)(deps.repoRoot, deps.agent)` at `:1252` with `deps.agent`; the SDK deps (`agentRunSettings`, `promptCandidates`) are built once in `runnerDeps`. Find where the take-up applies the assignment (`takeUpRefusalOf`, `:895-935`, `:1491`) and carry the slice's agent from there to both places. Read how the plan's slice annotation is parsed (`git grep -n "agent:" packages/domain/src`) before adding a reader; reuse the parser that exists.
2. **A charter the loop cannot read refuses the slice.** The loop logs the branch and the reason, gives the assignment back through the existing refused-take-up path (`takeUpRefused` in `agentLoop`), and the slice returns to the queue. It does not fall back to the start-time charter, because a slice that names a model and runs on another is the defect.
3. **`.plot-worker.continue.md` is ignored and excused.** Add it to `.gitignore` beside the other `.plot-worker.*` entries (`.gitignore:58-66`), and make `desk_dirt` in `skills/plot/scripts/plot-desk-dirt.sh` excuse the whole line `?? .plot-worker.continue.md` as it excuses `?? PLOT-CORRECTION.md` (`:102`). Update the comment block at `:29-32`. Check `plot-worker-state.sh:577` (it filters with `PLOT_WORKER_RECORD`, `PLOT_EDITOR_LEFTOVER`) and decide from the code whether it needs the same line; do not change it without a failing case.

### The decisions the plan settles — do not re-derive them

**The charter is resolved at take-up, not at start.** The start-time value is the wrong subject: one process serves many slices, and `PLOT_AGENT` names the agent, not the slice's charter. Do not push the fix into the supervisor's start command; the plan places it in the loop.

**Refuse; do not fall back.** An unreadable charter refuses the slice and the slice goes back to the queue. A fallback to the start-time charter runs the wrong model without a word.

**No annotation keeps the start-time values.** `undefined` and "no `agent:`" are not an unreadable charter. A parser that refuses every slice without an annotation passes the refusal test and stops the whole fleet.

**Excuse the exact line.** `grep -vxF '?? .plot-worker.continue.md'` matches the whole porcelain line, as `PLOT-CORRECTION.md` does (`plot-desk-dirt.sh:32`). A pattern that matches any path ending in the name would excuse `docs/.plot-worker.continue.md`, which is a real file. Ignoring the name in `.gitignore` alone is not enough: `desk_dirt` reads `git status --porcelain`, and an ignored file no longer appears there, but the excuse also covers a checkout where the ignore rule is absent.

**One resolver.** `rules/prompt.ts` already answers charter questions; the plan's deliverable search found no existing take-up resolution and no second parser to add. Do not write a charter reader in the loop.

**Rules carried over unchanged.** Absent is not false. Read the exit code, not the emptiness. A function you write or rewrite is an arrow. TSDoc states what an export does and how it fails; the reasoning goes in the commit message. A script that runs once per agent per pass duplicates no rule (`docs/shell-and-domain.md`); this slice adds none.

### Done when

The plan's `## Done when` item for this slice is the specification: a free agent handed a slice annotated with a charter that names a model runs the prompt with `--model <that model>`; a merged desk that holds only `.plot-worker.continue.md` is reaped. Assertions that exist because a naive implementation passes without them:

- **The model reaches the command line.** Assert the argument the runner receives, not that the resolver was called. A resolver wired to a log line passes a call-count test.
- **Both runners.** The charter applies on the `sdk` runner (model, effort, window from `agentRunSettings`) and on the `command` runner (prompt file). A fix on `runPrompt` alone leaves the SDK settings built at start.
- **No annotation, no change.** A slice with no `agent:` runs with the start-time values.
- **An unreadable charter refuses the slice.** Assert the log, the returned assignment, and that no prompt started.
- **The reap fixture holds only the continuation file.** A desk with `.plot-worker.continue.md` plus one real untracked file stays unreaped. A fixture with only the continuation file proves the excuse, and the second proves it is an exception rather than a hole.
- **The generated bundle.** `skills/plot/scripts/board/plot-worker-loop.mjs` is generated. `pnpm build:board` rebuilds it for local tests only. Do not commit the rebuild (`scripts/check-no-bundle-diff.sh`).

Plus the repo's gates: a `'@plot-pm/board'` changeset and a `'plot': patch` (the desk-dirt script ships), description first and the `bumps:` block last. Run `scripts/check-changeset-packages.sh`. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base: the one excuse line grows `plot-desk-dirt.sh` by at least one line, so remove an equal number of shell lines elsewhere in the same change, or keep the added line by merging it into the existing `grep` chain without a new line. The gate stores no number and has no override.

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. Use Node 24 (`nvm use`). Do not run board tests while an operator's board is open on this machine.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Where a project board is configured, set the PR to "Ready" with `plot-update-board.sh`. The PR body names issues #1169 and #1166.

### Scope guard

This branch owns:

- `packages/board/src/server/entry/worker-loop.ts`: the charter resolution at take-up, in `runnerDeps`, `runPrompt` and the take-up path. Wave 4 edits `:821` (`buildRun`); leave it.
- `packages/board/test/unit/worker-loop-run.test.ts` and the reap tests under `test/reconcile/` that cover `desk_dirt`.
- `.gitignore` and `skills/plot/scripts/plot-desk-dirt.sh`.

Not this branch's: `buildRun`, `buildFindingFor`, `continue.ts:534` (wave 4); the checks reading (wave 1, merged); the dollar parser (wave 2, merged).

Other branches in flight on origin at dispatch: `bug/a-claim-has-a-release-controller`, `bug/a-pending-check-is-asked-again`, `bug/deliver-reads-the-pr-index-first`, `bug/local-checks-find-tests-in-a-temp-worktree`. Any that touches `worker-loop.ts` or `plot-desk-dirt.sh` collides at merge time, so rebase before the PR.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
