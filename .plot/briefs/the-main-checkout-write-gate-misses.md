## Implementation brief — the-main-checkout-write-gate-misses (wave 1: Gate)

- **Plan (canonical):** docs/plans/2026-10-24-the-main-checkout-write-gate-misses.md on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2540 merged
- **Branch:** `bug/the-main-checkout-write-gate-misses` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `Review: pr` — plot-review on the PR, per repo convention

The `Writers` wave (`bug/the-main-checkout-writers-test-asserts`) waits on this branch: its test reads the gate and the prompt.

### What to build

The gate that refuses an unattended (`PLOT_UNATTENDED=1`) git write in the main checkout does not see a git call behind a shell keyword. Measured by issue #2487 against `origin/main` at `84b1638e4`: `if git commit …`, `for … ; do git checkout …`, `{ git reset …; }`, `! git …`, `time git …` and `a & git commit` all pass, so the board's gate (`packages/board/src/server/entry/gate.ts`) lets an agent write the checkout the board reads.

Build on `gitWriteDirs` in `packages/domain/src/rules/main-checkout-write.ts`, which already splits a command on `SEPARATORS` and judges each simple command through `writeDirOf`:

1. Find a git call after a leading `if`, `for`, `{`, `!`, `time`, and after a single `&`. `programWords` is the place that already strips leading words.
2. Add `tag`, `notes`, `clean -f` and `fetch <src>:<dst>` to the mutating set. `readsOnly` is where the read-only forms go: `tag -l`/`--list`, `notes list|show`, `clean -n`/`--dry-run`, and a `fetch` whose refspec has no `:`.
3. Skip the body of an unquoted heredoc, so a body line starting with `git checkout` is not refused.
4. Decide the failed linked-worktree read in `gate.ts` (`gitWhere`, `linked.ok && linked.value`): it counts as the main checkout today, so it refuses. Keep refusing and state it in the docs; passing would hide a broken read.
5. Clear `PLOT_MAIN_CHECKOUT_WRITER` in the continuation launch env in `packages/fleet/src/shared/continuation.ts` (the `...process.env` spread near line 1044; the plan cites `:1017`, which has drifted).

Each scanner case gets a domain unit test in `packages/domain/test/main-checkout-write.test.ts` with a refused and a passing example. The board gate has `packages/board/test/unit/main-checkout-gate.test.ts`.

### Settled — do not re-derive

**A failed worktree read refuses.** The plan's Open Question offers refuse or pass; refuse is the safer default, and the plan says passing hides a broken read. Record the choice in the docs next to the gate so docs and code agree.

**`clean -f` covers `-fd` and `-fx`; `-n` and `--dry-run` pass.** A dry run mutates nothing. Match the force flag inside a combined short-option word, not only the literal `-f`.

**There is no shell copy of the scanner to keep in step.** Checked on `origin/main` 2026-10-24: `MUTATING_GIT_SUBCOMMANDS` and `main-checkout-write` appear only in the domain rule and its TypeScript callers, and `packages/domain/corpus/` holds no main-checkout pair. No corpus test is needed. If the scan finds one while you work, stop and report.

**The scanner stays quote- and comment-blind by design.** `withoutQuotes` and `withoutComments` run first, so a refused word inside a quoted string is not a call. Keep it; the heredoc rule is the one new "not a command" region.

**Rules carried over:** a call the text cannot place is allowed, never refused (`cd "$desk"` is the form the refusal text recommends); the gate reads its own process env, not a `VAR=1` prefix in the command; arrow functions for every function you write; TSDoc states behaviour, not history.

### Done when

The plan's behaviour is the specification: the gate refuses a git write after `if`, `for`, `{`, `!`, `time` and a single `&`; covers `tag`, `fetch src:dst`, `notes` and `clean -f`; ignores heredoc bodies; a continuation launch clears `PLOT_MAIN_CHECKOUT_WRITER`.

Assertions a naive implementation passes without:

- `a && b & git commit` and `a & git commit`: a naive split on `&` alone breaks `&&`. Assert `&&` still splits as before.
- `git tag -l`, `git clean -n`, `git notes show`, `git fetch origin main` all PASS. A scanner that adds the subcommand without `readsOnly` refuses reads.
- A heredoc body line `git checkout x` passes, while a `git checkout x` on the line after the terminator is still refused. A scanner that drops everything after `<<` passes both.
- A quoted heredoc delimiter (`<<'EOF'`) and an indented one (`<<-EOF`) skip the body too.
- The continuation env test asserts the launched environment has no `PLOT_MAIN_CHECKOUT_WRITER=1` while the parent has it set.

Plus: add a changeset with its `bumps:` block, description first. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI. `scripts/check-shell-lines.sh` refuses shell growth, so touch no `.sh` file here. Do not commit a generated board bundle.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`. Then append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/main-checkout-write.ts`, `packages/domain/test/main-checkout-write.test.ts`, `packages/board/src/server/entry/gate.ts` with its test, `packages/fleet/src/shared/continuation.ts` with its test, the docs that state the gate's behaviour, and one changeset. It does not touch `.plot/worker-prompt.md`, `.plot/worker-prompt.sh`, `test/reconcile/main-checkout-writers.test.mjs` or the plan `recording-a-slice-pr-number-writes`: those belong to the `Writers` wave. The branch `bug/implement-restores-the-checkout` (plan `implement-leaves-the-main-checkout-on`) is in flight in the same area; rebase over it rather than redoing its work.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
