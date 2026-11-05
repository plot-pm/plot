# Seams juror

Position: amend

Lens: where the change meets other plans, open PRs and branches, declared shell/domain duplicates and the corpus tier.

## Findings

1. **The plan reverses a recorded decision and does not say so.** `docs/plans/2026-10-27-the-controller-gate-reads-a-grep.md:65-67` lists `sed`, `awk` and `rg` under "Reads that stay refused (out of scope)", and `:119` records "Does `sed` join the set? — No ... Panel round 1, unanimous." The #2770 CHANGELOG entry (`CHANGELOG.md:1229`) says "`sed`, `awk` and `rg` stay refused on purpose". The plan's Motivation reads the absence from `READERS` as a gap ("What `READERS` does not list"). It must name the earlier decision and state what changed (the cost of one rewrite per use, measured how often).

2. **Tests on `origin/main` pin the refusal the plan removes, and the plan names none of them.** `packages/domain/test/ci-suite.test.ts:288-290` expects `'dispatch'` for `sed -n '1,5p' …`, `awk 1 …` and `rg -n x …`. `test/reconcile/controller-gate.test.mjs:845` expects status 2 for `sed -n '1,5p' ${D}` ("kept deliberately"). The slice flips at least the `sed` and `rg` rows; the `awk` row stays or flips depending on Open Question 2. A Sonnet agent that meets these red tests has no instruction whether to flip or keep them.

3. **The issue's latest comment is a different command and the plan does not reach it.** The 2026-11-04 comment on #2530 reports `pgrep -f "plot-approve.mjs <slug>"` refused in the master session on Plot 2.30.0. `controllerInvocation` (`ci-suite.ts:224-236`) splits on whitespace without removing quotes, `wordBasename` (`ci-suite.ts:299-303`) strips the leading `"`, so `plot-approve.mjs` reads as a run. Adding `sed`/`rg` changes nothing for `pgrep`, `ps` or `lsof`. The plan must either add a `pgrep`/`ps`/`lsof` slice with the comment's guard (`pkill` with a signal and `| xargs` stay refused), or name the case as out of scope with a follow-up issue. This is the refusal measured in the sprint's own session, so it bears on the zero-interventions goal more than `sed` does.

4. **The comment and the plan disagree on what #2706 shipped.** The comment says #2706 "fixed `grep`, `sed -n`, `awk` and `cat`". The code (`ci-suite.ts:66-68`), the tests in finding 2 and the CHANGELOG say `sed` and `awk` stay refused. The plan is right against the code; the Open Question "Does the gate refuse `sed`, `rg` and `awk` today?" can be closed by the tests in finding 2 rather than a live reproduction.

5. **The guards land on one of two reader paths.** The plan puts the guards "beside the `git` run-option guard", which is `isReadSegment` (`ci-suite.ts:359-366`). `withoutDataLists` calls `isReader` directly (`ci-suite.ts:111`), which has no guards. After the change, `for f in plot-approve.sh; do awk 'BEGIN{system("bash " ARGV[1])}' $f; done` or a `sed` body with an `e` command empties the loop's word list and reads as no run. The same gap exists today for `git diff --ext-diff` in a loop body, so it is inherited, but the plan widens it to programs whose run forms are in-band. Amend: put the guards in `isReader`, or make `withoutDataLists` call `isReadSegment`, and add a loop-body test for each guard.

6. **`isReadSegment` has three callers; the plan names the gate only.** `controllerInvocation` (`ci-suite.ts:228`), `controllerHttpAction` (`ci-suite.ts:257`) and `mergeCall` (`controller-gate.ts:248`). `mergesBy` runs `withoutQuotes` before it splits (`controller-gate.ts`, `mergesBy`), so on the merge path a guard that inspects `awk`'s program text or `sed`'s script sees blanks. The result on `origin/main` stays correct because the merge words are blanked too, but the plan should state that guards read the raw words and pin one merge-path test (`rg pr-merge skills/plot/scripts/plot-host.sh` → no unpinned merge).

7. **Scope is inconsistent inside the plan.** The Changelog and Approach admit `awk`; the only slice is `feature/controller-gate-reads-sed-and-rg`; Open Question 2 is unanswered. A person decides `awk` before approval, and the Changelog line matches the slice.

8. **Line citation.** `READERS` is at `ci-suite.ts:66-68` on `origin/main`, not `:60`.

## Seams checked and clear

- Open PRs: none of the 13 open PRs (#3133, #3132, #3131, #3130, #3129, #3128, #3127, #3112, #3111, #3110, #3109, #3105, #3076) touches `ci-suite.ts`, `controller-gate.ts`, `gate.ts`, `shell-reading.ts` or `plot-controller-gate.sh`.
- Active plans: `who-may-approve-a-release-and` edits `controllerInvocation`, and its gate slice landed (#3083). `pr-review-accepts-a-plot-review` (Approved, same sprint) has `feature/the-review-status-has-one-writer`, which edits `gate.ts`'s controller path and states "No second parser is written in `controller-gate.ts`". No file overlap with the reader set and no ordering constraint follows; a `rg`/`sed` over `plot-review.mjs` is not a status write.
- Shell/domain duplicates: `skills/plot/scripts/plot-controller-gate.sh` is a launcher (`exec node "$bundle" controller "$@"`, line 19). No shell reader list exists, so no corpus test pairs this rule and the shell-lines ratchet is not touched.
- Corpus tier: no `packages/domain/corpus/*` file reads `controllerInvocation` or `isReadSegment`.
- `scripts/check-script-names.sh:94-101` counts the three script-name constants in `ci-suite.ts`; the change adds no literal.
- Docs that restate the reader set: the TSDoc at `ci-suite.ts:96-99` and `:197-205`. The slice updates both.

## Amendments required

1. Name the #2706 decision (`2026-10-27-the-controller-gate-reads-a-grep.md:65-67, :119`) and the reason to reverse it.
2. List the tests that flip: `ci-suite.test.ts:288-290`, `controller-gate.test.mjs:845`, with the expected value after the change for each row.
3. Address the `pgrep -f` residual from the issue's latest comment: a slice, or an explicit out-of-scope line with a follow-up issue number.
4. Put the guards where `withoutDataLists` also reads them, and add loop-body tests.
5. State that guards read raw words, and add one merge-path test.
6. Resolve `awk` and make Changelog, Approach and slice agree.

## Decisions for a person

- Whether to reverse the unanimous #2706 panel decision on `sed`/`rg`/`awk`.
- Whether `pgrep`/`ps`/`lsof` joins this plan or gets its own.

## Ran versus read

Ran (read-only): `git show origin/main:` of `ci-suite.ts`, `controller-gate.ts`, `gate.ts`, `plot-controller-gate.sh`, `check-script-names.sh`, the #2706 plan, the active plans and the sprint file; `git grep` for test rows and CHANGELOG; `gh issue view 2530 --comments`; `gh pr list` and `gh pr view <n> --json files` for 13 open PRs. Read only, not executed: the `pgrep` tokenisation and the loop-body bypass in findings 3 and 5 are traced through the source, not run through `plot-gate.mjs`.
