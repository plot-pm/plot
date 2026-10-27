## Implementation brief — the-controller-gate-reads-a-grep

- **Plan (canonical):** docs/plans/2026-10-27-the-controller-gate-reads-a-grep.md on main
- **Approved:** 2026-10-27, Jan Wloka, plan-PR #2759 merged
- **Branch:** `feature/the-controller-gate-reads-a-grep` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per plan Review: `pr`

Single-branch plan — no waves, nothing else to coordinate against.

### What to build

The controller gate refuses a read-only command whose file operand is a gated script. Issue #2706: `grep -n 'orphaned claim' skills/plot/scripts/plot-reap.sh | head; grep -n 'holds no claim' skills/plot/scripts/plot-dispatch.sh | head -3` answered `plot-dispatch.sh is a controller-owned action`, though no script runs. The same search with a glob (`*.sh`, which names all three gated scripts and so none) passed. An agent refused this way rewrites the command around the name or takes the unowned-action receipt, and both teach routing around the gate.

The cause is `isReadSegment` (`packages/domain/src/rules/ci-suite.ts:302`), which accepts three programs: `ls`, `cat`, `git grep`. The same file already holds `isReader` (`:68`), which answers `READERS` (`:60`) plus `git diff|show|log|grep`, and uses it only for `for`-loop bodies. The change makes `isReadSegment` delegate to `isReader`, then adds three guards so the wider set does not hide a run. `unpinnedProgram` (`controller-gate.ts:242`) calls `isReadSegment` too, so the merge-pin check gets the same predicate: `grep -n pr-merge skills/plot/scripts/plot-host.sh` stops reading as an unpinned merge.

### Decisions the plan settles — do not re-derive them

**One predicate, no third list.** `isReadSegment` calls `isReader`. A second reader list is how the loop-body reading and the segment reading drifted apart.

**The guards are needed because `controllerInvocation` has no `readShell` fallback.** `unpinnedMerges` (`controller-gate.ts:280-283`) re-reads a reader segment's substitutions; `controllerInvocation` does not. With no guard, `grep x $(…/plot-dispatch.sh s)` reads as a read and hides the run. The same hole exists today for `cat $(…/plot-approve.sh y)`; this change closes it.

1. **Substitution is a run.** Any word in a reader segment holding `$(`, a backtick, `<(` or `>(` makes the segment a run. Extract the pattern `withoutDataLists` uses at `ci-suite.ts:105` (`/\$\(|`|[<>]\(/`) into one helper and call it from both places. `wordBasename` (`:249`) strips a leading `$(` and quote but not a backtick, `<(` or `>(`; strip those three too, or `` `plot-dispatch.sh y` `` and `<(plot-dispatch.sh y)` name no script.
2. **An assignment prefix or `env` is a run.** `programWords` (`:119`) strips `NAME=value` and `env` before the program word, so `GIT_EXTERNAL_DIFF=…/plot-dispatch.sh git diff` looks like a plain `git diff`. Compare the segment's words against `programWords(words)`: a difference means a prefix, so not a read. Measured by the safety juror in a throwaway repo: this runs the script with no flag.
3. **A git option that runs or writes is a run.** `--ext-diff`, `--textconv`, `--output`/`--output=…`, `-O`/`-O…`, `--open-files-in-pager`/`--open-files-in-pager=…` on `git diff|show|log|grep`. `git grep -O./probe.sh b` and `git log --ext-diff -p -1` ran a program in the juror's throwaway repo; `git show --output=…` overwrites a file.

**`sed`, `awk`, `rg` stay refused.** `sed` runs with `e` and writes with `w`; `awk` runs through `system()`. Panel round 1 was unanimous. Do not add them to `READERS`. Mutation 7 kills it.

**A doubtful shape stays a read.** The gate keeps a master agent on its controllers; it is not a boundary against an adversary. Each extra guard turns an honest read back into the refusal #2706 reports. Do not add guards beyond the three.

**Known holes are pinned, not closed.** `cat …/plot-dispatch.sh | bash -s s`, `grep . …/plot-dispatch.sh | bash -s s` and `head -n 9999 …/plot-dispatch.sh > /tmp/d.sh` return `null` after the change. Closing a pipe means reading the whole pipeline and refusing every honest `grep … | xargs grep …`. A test pins each at `null`, so a later change to it is a decision. A shell function shadowing a reader name is a third hole with no test row.

**Out of scope:** `git -C . grep` (and any git global option before the subcommand, because `isReader` takes the second program word as the subcommand), `nl`, `less`, `md5`, `file`, `git blame`, `time grep`, `command grep`, `bash -n`, `shellcheck`, `node --check`, and a gated name inside quoted text.

**Rules carried over:** a gated name read as data in a `for` list stays a run unless the body only reads; `bash`, `sh` and `xargs` over a gated script, `find … -exec`, and `git rebase --exec` stay `'dispatch'`.

### Done when

The plan's `## Done when`-equivalent is its `### Acceptance` section; it is the specification. The assertions that exist because a naive implementation would pass without them:

- **Naive widening (`isReadSegment = isReader`, no guards) must fail the substitution rows.** `grep x $(…/plot-dispatch.sh s)`, ``wc -c `…/plot-dispatch.sh s` ``, `diff <(…) f`, `tail -f /dev/null >(…)`, `[ -n "$(…/plot-deliver.sh s)" ]` → `'deliver'`, `wc -l $(plot-deliver.sh --release 1.0 x)` → `'release'`, and the bare-name forms with a backtick and `<(`. They catch a guard that sees only `$(`.
- **The assignment rows** (`GIT_EXTERNAL_DIFF=… git diff`, `GIT_PAGER=… git grep x`, `env PAGER=… cat x`) catch a predicate that reads only the program word after `programWords`.
- **The git-option rows** catch a guard that covers `git grep` only.
- **`bash …/plot-dispatch.sh grep` → `'dispatch'`** catches a predicate matching any word, not the program.
- **`cat $(…/plot-approve.sh y)` → `'approve'`** pins the closed pre-existing hole.
- **`grep x $(gh pr merge 12)` → `unpinnedMerges` `['gh']`** pins the merge check's `readShell` fallback.
- The two tests that invert: `packages/domain/test/ci-suite.test.ts:206-209` (split and rename to cite #2706; `grep` row → `null`, `sed` row stays `'dispatch'`) and `test/reconcile/controller-gate.test.mjs:808-818` (`grep -c foo ${D}` → status 0, `sed -n '1,5p' ${D}` stays status 2; add a status-2 row for `grep x $(${D} slug)`). Add one allow row in `packages/board/test/unit/controller-gate-readings.test.ts:85-110`.
- Run the eight mutations in the plan's *Mutations the acceptance kills* and record in the PR body that each ran and which test failed. Commit before mutating.

TSDoc that changes: `ci-suite.ts:186` (the `controllerInvocation` block naming "`ls`, `cat` or `git grep`"), `ci-suite.ts:301` (`isReadSegment`) and `controller-gate.ts:261` (`unpinnedMerges`). State what each function does, not the history; the reasoning belongs in the commit message.

Style: new functions are arrows (`const f = (…) => …`). Keep the domain package's TSDoc factual.

Plus: the change is domain TypeScript only and adds no shell lines, so `scripts/check-shell-lines.sh` is untouched. The PR carries no generated bundle (`scripts/check-no-bundle-diff.sh`); run `pnpm build:board` only to test `controller-gate.test.mjs` locally, then restore the generated paths. Add a changeset for package `plot` with the description first and the `bumps:` block last (the plan's Changelog entry is the description; bump `plot` patch or minor per the plan, with `plan: docs/plans/2026-10-27-the-controller-gate-reads-a-grep.md` in the block). For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Use Node 24 (`nvm use`).

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to the branch line under `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/ci-suite.ts`, `packages/domain/src/rules/controller-gate.ts`, `packages/domain/test/ci-suite.test.ts`, `packages/board/test/unit/controller-gate-readings.test.ts`, `test/reconcile/controller-gate.test.mjs` and one changeset. No other branch of this plan exists. `controller-gate-fires-on-a-script` is Delivered and edited the same file region; read its result on main, do not undo it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
