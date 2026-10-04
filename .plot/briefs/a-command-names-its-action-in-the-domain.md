## Implementation brief — the-shell-shrinks-into-the-domain (wave 3: A command names its action in the domain)

- **Plan (canonical):** `docs/plans/2026-10-03-the-shell-shrinks-into-the-domain.md` on `main` (round 3)
- **Approved:** 2026-10-03, jwloka, in-session
- **Branch:** `infra/a-command-names-its-action-in-the-domain` (base: `main`)
- **Ends as:** one PR to the base, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is wave 3 of 4. Waves 1 (`infra/the-shell-cannot-grow`, #1264) and 2 (`infra/the-shell-is-inventoried`, #1266) are merged: `scripts/check-shell-lines.sh` is on `main`, and it applies to this slice. Wave 4 (`infra/the-first-script-becomes-a-command`) waits on wave 2 only, so it does not wait on this slice, but it reuses this slice's missing-bundle message.

### What to build

`skills/plot/scripts/plot-controller-gate.sh` decides which controller action a command runs by looping over the command's whitespace tokens (`for tok in $CMD_SCAN`, line 209 on `main` at `1c67ea07b`) with pathname expansion on. That loop refused `ls skills/plot/scripts/*.sh` as `plot-approve.sh` on 2026-10-03, because the glob expanded to every script and one of them was gated (#1245). It refused two read-only `git grep` commands the same afternoon, one for a `*.sh` pathspec and one for a pathspec naming `plot-dispatch.sh`. A decision of this kind is not reachable by a unit test while it lives in a shell loop.

Build `controllerInvocation(command)` in `packages/domain/src/rules/ci-suite.ts`. It returns `'dispatch'`, `'approve'`, `'deliver'` or `null`. Build it on the functions already in that file (`withoutQuotes`, `programWords`, the `&&`/`||`/`;`/`|`/newline split in `ciSuiteRefusal`), so one reading of "does this command RUN a script" serves both rules. The rule must:

- tell a script that is RUN from one that is READ or mentioned: `ls skills/plot/scripts/plot-dispatch.sh`, `git grep plot-deliver.sh` and `cat plot-approve.sh` return `null`; `bash skills/plot/scripts/plot-dispatch.sh x`, `./plot-approve.sh x` and `for s in a b; do plot-dispatch.sh $s; done` return the action. The loop case is the defect the gate was built for (see the gate's header: five dispatches in one session), and it is a RUN even though the word is not in command position;
- strip single-quoted heredoc bodies, as `strip_quoted_heredocs` does today (`<<'EOF'` and `<<-'EOF'` only; an unquoted `<<EOF` body stays tokenised, because it can hold a command substitution);
- keep the mode split: `plot-dispatch.sh` with `--status`, `--dry-run`, `--stop`, `--restart`, `--start`, `--migrate`, `--release`, `--help` or `-h` is a read or has no endpoint; `plot-approve.sh` and `plot-deliver.sh` exempt `--status`, `--dry-run`, `--help` and `-h` only; `plot-deliver.sh --release` is the action `release`, not `deliver`. The gate's `action` word for it is `release`, so the rule's return type must carry `release` as a fourth answer, or the shell keeps a second decision. Settle that in the type and say which in the PR body;
- match a glob word against the three basenames as a pattern, so `bash skills/plot/scripts/*dispatch.sh x` still reads as `dispatch`, as the token loop's expansion reads it today. A glob that matches none of the three (`*.sh` after `ls`) is not a run.

Fold `loopWord` in `packages/domain/src/rules/start-command.ts` (line 48) onto the same reading: it is a third matcher for "does this command run script N". If the fold changes an answer `start-command.test.ts` pins, stop and report it; do not edit the test to fit.

Bundle it on its own: an entry `packages/board/src/server/entry/controller-invocation.ts` that reads the command on stdin and prints the action, declared in `packages/board/build.mjs` as a `shipped<Name>` binding (the pattern `localChecks` and `emptyClaim` follow, and the one `scripts/main-bundles.sh` and `scripts/check-bundle-resolution.sh` derive from) and bundled to `skills/plot/scripts/board/plot-controller-invocation.mjs`. Import through the narrow path (`@plot-pm/domain/rules/ci-suite`), for the reason `entry/empty-claim.ts` gives. Mirror that entry's exit-code contract and read the exit code, not the output's emptiness: `null` and a failed read must not look alike.

Then change `plot-controller-gate.sh` to ask it. The order inside the gate is settled below.

### The decisions the plan settles — do not re-derive them

**The rule goes in its own bundle, not in `plot-local-checks.mjs`.** The hook runs on every Bash call of every session, fleet agents included. Measured 2026-10-03 at load 6.9 on 16 cores: four PreToolUse hooks cost 65–70 ms per Bash call; `node` plus a small bundle costs 22–30 ms; `plot-local-checks.mjs` (528 KB) costs 52–61 ms. Reusing it for this question adds that cost to a command that has nothing to do with checks. Re-measure on the day you start and put the numbers in the PR body.

**`node` starts only for a word that could name a gated script, and the test that decides is per word.** The order is fixed:

1. **A per-word prefilter in shell, with pathname expansion off** (`set -f`). A command passes only if one of its words contains `plot-dispatch`, `plot-approve` or `plot-deliver`, or ends in `.sh` and holds a glob character (`*`, `?` or `[`). Everything else exits 0. That is what today's gate does with a command whose expanded words name no gated script. The prefilter only skips work and decides nothing, so it may over-pass and must never under-pass. A whole-command test let 31 % of 32,352 logged Bash calls through; the per-word test measured 8.7 %. Record the rate of the test you ship (the log is the one the plan's Notes measured against; say where you read it).
2. **The desk exemption**, after the prefilter. Its three `git rev-parse` calls cost 15–16 ms and only the commands that passed pay them. Today it runs after the script-name loop (lines 284–292); move it ahead of the rule.
3. **The rule**, through the new bundle.
4. **The receipt**, last, because it needs the action the rule returns.

The CI-suite arm (`PLOT_UNATTENDED`, lines ~160–200) stays first, ahead of every early exit, for the reason its own comment gives: a fleet agent's command passes both the named-script exit and the desk exemption, so an arm placed after either never fires. Do not touch it.

**A command that passed the prefilter and cannot be checked is refused.** The gate's header says *fail-open on its own machinery, closed on the case it exists for* (`:61-67`). A command that passed the prefilter is that case. So a missing bundle, a bundle that exits non-zero for another reason than "no action", or an unreadable answer refuses that command, exit 2. Commands the prefilter exits on are never affected, so a missing bundle never blocks `ls`. The message names the missing file and gives both remedies: update the plugin in an adopting repository, or run `pnpm build:board` in the plot repository. Wave 4's launcher uses the same text, so keep it in one place that wave 4 can reuse. The existing `trap 'exit 0' ERR` turns any failing command into allow, so read the bundle's status with `|| rc=$?` the way the CI-suite arm does, or the refusal never fires.

**No exemption list is added.** The three scripts and their endpoints stay as the gate lists them. Adding a name to skip `ls` or `git grep` would be the widening the plan was written to stop.

**The three commit hooks are not part of this slice.** `plot-phase-gate.sh`, `plot-state-gate.sh` and `plot-brief-name-gate.sh` each exit before their token loop on every command #1245 lists, because each reads only commands that contain `git commit`. `plot-state-gate.sh` expands globs on purpose, to count every file a glob could cover (`:74-77`). Leave all three.

**#1245 reaches a session only with a release.** Hooks run from the installed plugin (`cache/plot-marketplace/plot/<version>`), not from the checkout. The bundle ships because `build.mjs` declares it in a `shipped*` binding, which `scripts/main-bundles.sh` reads in `release` mode before a tag. Say so in the changeset's description and do not claim the issue closed on merge.

**The count is paid in the same change.** `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base, and this slice edits `plot-controller-gate.sh`. The token loop (lines 208–217, about 10 code lines), `gated_action` (about 6) and the mode-split `case` blocks (about 20) leave the shell, and the prefilter, the bundle call and the refusal come in. Measure the net with `./scripts/check-shell-lines.sh pr` and `--per-file` before the first push; the plan expects a decrease, and an increase means the decision is still in shell. The gate stores no number and has no override.

**Rules carried over unchanged.** Absent is not false: a missing or unreadable answer is a refusal here, never an allow. Read the exit code, not the emptiness of the output. A heredoc body mentioning `--dry-run` must not exempt a real invocation sharing its command line (measured 2026-09-17: allowed before the strip, refused after). A function you write is an arrow (`export const f = (…) => …`); the declaration style of the board is not the model.

### Done when

The plan's `## Slices` line for this branch is the specification: `controllerInvocation(command)` on `rules/ci-suite.ts`, in its own bundle; `plot-controller-gate.sh` asks it after a per-word prefilter and the desk exemption, and refuses a command it cannot check (#1245).

The assertions that exist because a naive implementation passes without them:

- **A unit test per row of the table in the rule's TSDoc, with RUN and READ pairs for each script.** `ls skills/plot/scripts/*.sh`, `git grep -l plot-dispatch.sh -- '*.sh'` and `git grep -n x -- skills/plot/scripts/plot-deliver.sh` return `null`; the three RUN spellings above return the action. A rule that returns `dispatch` for any command containing the word passes the RUN half and fails the READ half.
- **A unit test for the loop spelling and for the glob RUN.** A fix that moved to command-position matching would pass every READ case and go blind to the defect the gate exists for.
- **A heredoc test in both directions.** A `<<'EOF'` body naming a gated script is data; an unquoted `<<EOF` body is not stripped; a body holding `--dry-run` does not exempt a real invocation on the same line.
- **`plot-deliver.sh --release 2.22.3 x` returns the release action, and `plot-dispatch.sh --release <branch>` returns `null`.** The `--release` scoping to `plot-dispatch.sh` alone is what `a-release-is-a-controller-command` closed, and a rule that exempts `--release` everywhere reopens it.
- **`test/reconcile/controller-gate.test.mjs` fires the real hook for the three #1245 commands and they are allowed.** It runs the gate through `spawnSync` with the hook JSON on stdin, from a repository root. Add the three as cases, with the bundle built. A unit test of the rule alone does not prove the hook asks it.
- **A test with the bundle absent: a command naming a gated script is refused with exit 2 and the message names the file and both remedies; `ls` is allowed with the same bundle absent.** The second half proves the prefilter spares the commands it must. Move the bundle aside inside the test's scratch copy; never rename or delete a file in the working tree, and delete only the path `mkdtempSync` returned.
- **The existing 36 tests in `controller-gate.test.mjs` pass unchanged.** A change to one of them is a change to behaviour and the PR body must name it.
- **The shell-versus-rule agreement is held, if any shell copy of the decision remains.** If the prefilter's word list repeats the three names, a test asserts it matches the rule's list (`docs/shell-and-domain.md` §1: a declared duplicate is held by a test that says the pair agrees). If you can derive the prefilter from the bundle's list, do that and the test is unnecessary.

Plus the repo gates: add a changeset in the format of an existing one in `git log` (`.changeset/` holds siblings' files; add your own and touch none) — the description first, the `plan:` and `bumps:` block last — with `'plot': patch`, naming `plot` under `skills:` as the skill whose behaviour changes, then run `./scripts/check-changeset-packages.sh`. The bundle is built on `main` after merge, and a pull request carries none (`scripts/check-no-bundle-diff.sh`): run `pnpm build:board` to test locally and restore every generated path before you push. Use Node 24 (`nvm use`); `pnpm` crashes on Node 26. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `pnpm run test:e2e` locally. `test/reconcile/controller-gate.test.mjs` is a single file: run it alone and re-run a failure alone before believing it.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice edits `plot-controller-gate.sh`, so growth is paid for in the same change: the decision moves into the domain and the shell shrinks, and an agent that finds the count rising has left the decision in shell. The gate stores no number and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line under `## Slices` in the plan. Push the first real commit as soon as it exists. Put in the PR body: the prefilter's pass rate and where it was measured, the hook's cost before and after, the `check-shell-lines.sh` counts before and after, and the decision on the `release` answer.

### Scope guard

This branch owns: `packages/domain/src/rules/ci-suite.ts` and its test, the fold in `packages/domain/src/rules/start-command.ts`, `packages/board/src/server/entry/controller-invocation.ts`, the declaration in `packages/board/build.mjs`, `skills/plot/scripts/plot-controller-gate.sh`, `test/reconcile/controller-gate.test.mjs`, the `plot-controller-gate.sh` row in `skills/plot/scripts/README.md` (its *kind* and *replaced by* cells, only if the table now says something false), and one changeset.

Out of scope: `plot-phase-gate.sh`, `plot-state-gate.sh`, `plot-brief-name-gate.sh`, the CI-suite arm of the gate, `plot-local-checks.mjs`, `plot-deliver.sh` (wave 4) and every other script. Do not add a name to a skip list.

No open pull request touches these files, verified on 2026-10-04 with `gh pr list --state open`: the only open PR is the release PR #1160, whose changesets are not yours. Verify again on the day you start; this list ages.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
