# Layering juror: controller-gate-refuses-read-only-commands

Position: amend

## Findings

1. **Placement is right.** The read/run decision lives in the domain: `controllerInvocation` and `isReadSegment` in `packages/domain/src/rules/ci-suite.ts:224` and `:359`. The board entry `packages/board/src/server/entry/gate.ts:1001` only calls it. The plan changes the domain predicate and touches no shell script and no `.tsx`, so the shell-lines ratchet does not move and no rule leaks into a component. No index read and no lifecycle action are involved; the gate is the thing that routes lifecycle actions to controllers, and the plan keeps its refusals intact.

2. **The plan omits the residual case that the issue's latest comment names.** The 2026-11-04 comment on #2530 reports `pgrep -f "plot-approve.mjs <slug>"` refused. The source explains why: `controllerInvocation` (`ci-suite.ts:225`) splits on `&&|\|\||[;|\n]` and reads words with their quotes, unlike `mergesBy` (`controller-gate.ts:~265`), which reads `withoutQuotes(...)`. A quoted `pgrep` pattern therefore reaches `scriptNamed` (`ci-suite.ts:~343`) and reads as a run of `plot-approve.mjs`. `pgrep` (without `pkill` or `xargs`), `ps` and `lsof` are process-table readers and belong in the same predicate. The only slice adds `sed` and `rg` and does not name `pgrep`.

3. **The comment and the plan disagree about `sed` and `awk`, and the source sides with the plan.** The comment says #2706 fixed `sed -n` and `awk`. `READERS` at `ci-suite.ts:61-63` holds no `sed`, `rg` or `awk`, so a `sed -n 1p plot-approve.sh` in the main checkout with no receipt reads as `approve`. The comment's observation probably came from a linked worktree (`gate.ts:999` returns `null` when `linked`) or a cleared receipt. The plan's first open question (reproduce with hooks active) is the right gate on this; it must also record where the reproduction ran (main checkout, not a linked worktree), or it repeats the plan's own false negative ("a local run ... allowed even a plain `plot-approve.sh foo`").

4. **The guards must sit in `isReader`, not only in `isReadSegment`.** `isReader` has three callers: `isReadSegment` (`:360`), `withoutDataLists` (`:111`, the `for` loop body) and, through `isReadSegment`, `mergeCall` (`controller-gate.ts:248`). The `git` run-option guard the plan copies sits only in `isReadSegment` (`:364`). A `sed e` or `rg --pre` guard placed there leaves `for f in plot-approve.sh; do sed e "$f"; done` read as a data list, and `sed e` runs every line of the file as a command. The plan says "the guards sit beside the `git` run-option guard", which points the agent at the wrong function.

5. **The `sed` script guard is an undecided parse.** Segments split on `;` and `|` before any quote handling, so `sed -n '1p;w out' f` arrives as two segments. That over-refuses (the second segment's program is `w`), which is safe, but the plan does not say how the agent detects an `e`/`w` command inside one word (regex over the quoted script word? any `e`/`w` letter after an address?). An unattended agent will invent one. The Changelog also says "`-s` write forms", which is not a `sed` concept the Design defines.

6. **Changelog and slice disagree on `awk`.** The Changelog admits `awk`; the slice builds `sed` and `rg` only; the Open Questions leave `awk` undecided. Shipped text then states behaviour the code does not have.

## Amendments required

- A. Add the `pgrep` residual to the plan: either a second slice (`pgrep` without `pkill`/`xargs`/`-signal`, `ps`, `lsof` as readers, or blanking quoted arguments of those readers before `scriptNamed`) or an explicit statement that it is out of scope with a follow-up issue. The issue's latest comment is the live defect; the plan as written leaves it refused.
- B. Name the function: the new guards go in `isReader` (or a guard both `isReader` and `isReadSegment` call), so the `for`-loop data-list path gets them too. Add a test: `for f in plot-approve.sh; do sed e "$f"; done` reads as `approve`.
- C. Decide the `sed` script check concretely (for example: any quoted or bare script word matching `/(^|[;}\s\/])[ew](\s|$|;)/`, plus `-i`, `--in-place`, `-i.bak`, `--in-place=`, and `-f <file>` refused because the script is not visible), and the `rg` forms (`--pre`, `--pre=…`; `--pre-glob` alone is harmless).
- D. Make the Changelog match the slice: drop `awk` unless a slice builds it, and drop "`-s` write forms".
- E. Record where the hook reproduction runs: main checkout, no action receipt, `PLOT_UNATTENDED` unset.

## Decisions for a person

- Whether `awk` is admitted at all (its program text can call `system()`; the plan's own question).
- Whether the `pgrep` case ships in this plan or in a separate one.

## Ran versus read

Ran: `gh issue view 2530 --comments`, `git show origin/main:packages/domain/src/rules/ci-suite.ts`, `git show origin/main:packages/domain/src/rules/controller-gate.ts`, `git show origin/main:packages/board/src/server/entry/gate.ts`, `git grep` for `isReadSegment`/`controllerInvocation` callers. Read only: the plan. Executed no gate, test or hook; the refusal paths above are traced from source, not reproduced.
