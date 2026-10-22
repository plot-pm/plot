## Implementation brief — reconcile-20-ignores-merges-3-proved (wave 1: Shared merge answer and applied limit)

- **Plan (canonical):** docs/plans/2026-10-22-reconcile-20-ignores-merges-3-proved.md on main
- **Approved:** 2026-10-22, Jan Wloka, plan-PR #2332 merged
- **Branch:** `bug/reconcile-20-ignores-merges-3-proved` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** per repo convention; open the PR through `plot-open-pr.sh`

This is the only slice of the plan. Nothing waits on it.

### What to build

On ewz-kus-portal (round 7, main `da789acff`) one run printed two answers for one branch. §3 called `bug/ewzkus-3678-sd-rechnungen-rechnungsliste` a deletion candidate because a per-branch `pr-merged` ask returned `merged`. §20 printed "(none — no remote ref outlives its merged PR)". Both sections ask "did this land", and only one of them used the answer the host gave. Two defects follow, both in `skills/plot/scripts/plot-reconcile-scan.sh`.

1. **§20 ignores what §3 bought.** §3 (`:1306`) asks the host per branch when `MERGED_PR_TRUNCATED=1` on Bitbucket, acts on the word `merged`, and drops it. §20 (`:2535`) reads `merged_pr_for_branch` (`:1095`), which searches only `merged_pr_heads`, the list Bitbucket cut at 50 rows. Record the branch in `merged_pr_heads` when §3 gets `merged`, so `merged_pr_for_branch` answers for it from then on.
2. **Both truncation notes name the wrong limit.** `:1189` and `:2571` print `$MERGED_PR_LIMIT`, which is the requested 500 (`:399`). Bitbucket applied a page of 50. On GitHub the host honours `--limit`, so 500 is right there and stays.

The plan is canonical; this brief orients.

### Settled decisions and leads

**The record holds an answer the host gave, never an ancestry verdict.** Carried over from *One Answer To "Did This Land"*: write the row only from a `merged` word. `unknown`, `not-merged` and a failed ask record nothing, and the orphan line stands (`bitbucket-cut-merged-list.test.mjs` pins this for §3, case 3). Do not add an ancestry check to make §20 agree.

**§20 reuses the answers §3 bought and asks nothing new.** This is the plan's recommended answer to its first open question. §20 per ref would cost one `pr-merged` call per remote ref on an account with a scarce Bitbucket budget. Add one line to the §20 note saying a ref §3 never asked about may still be missed. Record the choice in the PR description.

**The applied limit is already on stderr; read it, add no new signal.** `plot-host.sh:3033` prints `plot-host: bitbucket pr-list state=merged possibly truncated (50 rows, requested limit 500 unprovable)`. The scan already greps that file for `possibly truncated` (`:702`). Parse the row count from the same line and keep it in a variable (for example `MERGED_PR_APPLIED`), and print it in both notes. A new stdout marker or exit status would change a contract that `host.test.mjs:1718` and `:5547` pin (`state=merged possibly truncated \(50 rows`) and that `plot-pr-merged.sh:144` reads. The scan may not call `bb` itself (`check-host-cli-callers.sh`), and it does not need to. If the line carries no count, fall back to the old wording rather than print a number that is not there.

**`pr-merged` answers with a word, not a number.** `plot-host.sh:3890` prints `merged`, `not-merged` or `unknown`. §20 prints `PR #$pr_num` (`:2540`), and `merged_pr_heads` lines are `<number> <head>`. Do not change what `pr-merged` prints: its callers compare `= merged`, and `plot-pr-merged.sh` is sourced by four scripts. Decide how §20 prints a ref whose number is unknown, and say which you chose in the PR. A row with a placeholder number would make `merged_pr_for_branch` return a wrong PR to the other readers (`:1165`, `:2707`). Whatever you record, keep those two readers correct.

**§3 runs before §20, and the loop is not a pipeline.** The §3 loop ends `done <<< "$all_branches"` (`:1316`), so an assignment to `merged_pr_heads` inside it survives. Do not move the ask into a `| while` or a `$(...)`, or the record dies with the subshell. §2 (`:1180`) runs before §3 and is unaffected. The readers at `:1165` and `:2707` run after, and now see the recorded merge. That is the same evidence §3 used, and a test should show it.

**Rules carried over unchanged.** Absent is not false: a cut list proves no absence. Read the exit code and the word, never the emptiness. GitHub makes no per-branch call at all (`bitbucket-cut-merged-list.test.mjs`, case 4). Keep that.

**Open question 3 of the plan: `review-bypass`.** `:2592` passes `--limit "$MERGED_PR_LIMIT"` to `board/plot-review-bypass.mjs`, and the bundle asks the host itself. Read the bundle and answer whether it prints a limit, and whether it prints the wrong one on Bitbucket. If it does, fix it in this slice or file the follow-up. If it does not, say so in the PR. Do not leave the question unanswered.

### Done when

The plan's changelog is the specification: §20 lists a ref whose PR merged when §3 proved that merge with a per-branch `pr-merged` ask, and the truncation note in §2 and §20 names the limit the host applied.

Assertions a naive implementation passes without:
- **The branch sits OUTSIDE the 50 rows.** A fixture with the branch inside the page passes before and after. Copy the fixture of `test/reconcile/bitbucket-cut-merged-list.test.mjs`. The test must fail on `main` with §3 naming a deletion candidate while §20 prints "none".
- **The note names 50, and a 49-row page prints no note.** This catches a hard-coded 50 and the requested-limit regression together. Make the two arms disagree: stub a host whose applied page is not 50 (for example 30) and assert the note names it.
- **An `unknown` or failed per-branch ask leaves §20 at "none".** It catches a record written on any answer.
- **GitHub keeps `MERGED_PR_LIMIT` in the note and makes no per-branch call.**
- **A ref §3 never asked about** (not an orphan candidate) stays unlisted, and the §20 note says it may be missed.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there returns as a correction. Run the whole `test/reconcile/*.test.mjs` glob that the checks command prints, not only the files you suspect. Add a changeset (description first, `bumps:` block last, package `plot`, skill `plot-reconcile`). Do not commit the rebuilt board bundle.

**Shell gate.** `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base, with no number stored and no override. This slice edits `plot-reconcile-scan.sh`, so growth must be paid for in the same change: remove an equal number of shell lines elsewhere, or move a rule into the domain and ask it through a bundle. Count the lines before you start writing, so the budget is a plan and not a surprise at the gate.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (use `--draft` while work moves). Never run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists. Write test helpers as arrows (CLAUDE.md, *The Domain Package*).

### Scope guard

This branch owns §2, §3 and §20 of `skills/plot/scripts/plot-reconcile-scan.sh`, the truncation-count read in `load_merged_pr_heads`, `test/reconcile/` tests for them, and the changeset. It does not own `plot-host.sh`'s wording (pinned by `host.test.mjs`) or `plot-pr-merged.sh`. No other branch of this plan is in flight. The delivered plans `2026-10-21-reconcile-on-bitbucket-reads-merged-branches` and `2026-10-21-reconcile-does-not-report-a-plan` share the area and are not open. If you find something the plan did not anticipate, report it rather than improvising outside scope.
