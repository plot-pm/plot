# Juror verdict: destruction safety

Position: amend

Evidence: Read the plan, issue #2825 (`gh issue view`), #2730/#2815/#2807 titles, `packages/board/src/server/entry/reap.ts` (`runWorktreeKind` :670-970, `runBranchKind` :980-1060, `runClaimKind` :1125-1185, `runReap` :1241-1276), `packages/domain/src/rules/sweepable.ts` :50-100, `packages/domain/src/ports/host.ts` :229-243, `packages/domain/src/adapters/host/host-shell.ts` :306-405, `packages/domain/src/adapters/trees/trees-git.ts` :486, `skills/plot/scripts/plot-host.sh` :658, :2293, :4222-4262, and `test/reconcile/reap-failed-readings.test.mjs`. Ran a scratch-repo repro (`scratchpad/juror-2825-safety/repro.mjs`) of the shipped `plot-reap.sh` bundle at this tree, with a stubbed `gh` on `PATH`: one `--dry-run`, then one `--yes`, then `git branch` and `git cat-file` on the result. No vitest run; nothing in the repo was edited.

## (a) Problem statement

The repro shows three divergences. Two of them are not host divergence.

Repro output (abridged):

```
DRY RUN  -- worktrees --  would   desk     PR merged (squash)
         -- local branches --
         keep     desk      checked out in a worktree — somebody is reading it
         keep     flipper   unlanded work — no merged PR
         would    reused    PR merged (squash), no worktree holds it
         summary: ... branches=1 branches_deleted=0 branches_kept=3
YES      reaped   desk      PR merged (squash)
         deleted  desk      PR merged (squash), local ref deleted
         deleted  flipper   PR merged (squash), local ref deleted
         deleted  reused    PR merged (squash), local ref deleted
         summary: ... branches=3 branches_deleted=3 branches_kept=1
AFTER    reused tip e135157 -> object present (dangling only); origin does not hold it
```

1. **Host flip (the plan's cause): confirmed.** `flipper` is `keep` in the dry run and `deleted` under `--yes` because `runBranchKind` asks `ctx.host.prMerged` again (`reap.ts:1005`). Correctly cited.

2. **An in-run ordering cause the plan misses.** `runReap` runs `runWorktreeKind` before `runBranchKind` (`reap.ts:1268-1269`). Under `--yes` the worktree kind removes a desk (`reap.ts:901`), and then `runBranchKind` reads `ctx.trees.list()` again (`reap.ts:990`). The desk's branch is no longer `checked-out`, so the branch kind deletes it. In a dry run nothing is removed, so the same branch prints `keep — checked out`. No host answer changes in this case, and no dry run can show it. This explains the issue's `feature/EWZREL-*` rows ("not listed as would-delete" → "deleted — merged into develop") at least as well as host pressure does. The worktree kind's given-up arm also deletes a local branch (`reap.ts:910-912`), and that delete is outside any branch record.

3. **The branch kind deletes local-only commits that the dry run shows as safe.** `firstBranchRefusal` takes only `hasMergedPr` and `checkedOut` (`sweepable.ts:67-80`). `runBranchKind` sets `merged` from "any PR on this branch name merged" (`reap.ts:1005-1008`, `plot-host.sh:4238/4257`), and it never compares the local tip with the merged PR's head. The worktree kind does make that comparison (`unpushedCommits` → `prMergedHeads`, `reap.ts:435-462`). In the repro, `reused` has one commit after the merged head. The dry run prints `would`, `--yes` deletes it, and the commit is left dangling and exists on no remote. A recorded plan with a tip check does not stop this, because the dry run showed it. In the issue's account, `migration-abw-rechnungsempfaenger` was labelled "unlanded work" by the dry run, so this is the case to rule out before saying "nothing was lost".

4. **The cause of the count mismatch is misnamed.** `counters.deleted` increments only on a successful delete (`reap.ts:1048-1051`), so `branches_deleted` equals the number of `deleted` rows in the branch section. The repro shows 3 and 3. The real defect is that a failed delete increments both `swept` (`:1042`) and `kept` (`:1054`), so `branches + branches_kept` overcounts. The issue's 37/37 probably counts `deleted` rows from other sections: claim-kind rows (`:1173`) and worktree `local branch deleted`. The plan should measure this before it names a fix.

5. **Under a rate limit the host does not produce `merged`.** `merged` requires a successful response that holds a merged row (`plot-host.sh:4236-4238`, `:4253-4257`). A failed call goes to `miss_or_unknown` (`:658`), which prints `not-merged` when stderr is empty or matches "not found" (`:2295`), and `unknown` otherwise. The reap treats both as keep (`reap.ts:1006`). A 429 therefore makes the dry run show fewer deletions, and the later `--yes` shows more. That matches the issue's `migration-abw` row (dry `keep`, yes `deleted`). The 6 branches that went from `would` to `kept` are the same mechanism in the other direction, and that direction is harmless.

## (b) Approach

- **A recorded plan alone does not guarantee "deletes nothing the dry run did not show".** Acting only on the record's rows does close cause 1 and cause 2 for the branch kind. But the plan as worded ("deletes exactly those refs") makes the record the authority. Then a stale, hand-edited or tampered record, or one from another checkout, deletes any branch whose name and tip it lists, with no gate. The safe rule is **intersection**: `--yes --plan` deletes a branch only when the record says `would` at the same tip AND a fresh `firstBranchRefusal` at run time also allows it. A host flip or a forged row can then only remove deletions, never add one. Under 429 the fresh reading degrades to keep, which is safe. Put this rule in the domain as a pure function (`(recordRow, currentTip, freshReadings) → delete | keep(reason)`), per the Layering Rule. That makes "the approved set bounds the deleted set" unit-testable.
- **Moved tip:** check-then-`git branch -D` (`trees-git.ts:487`) leaves a race window. Use an atomic compare-and-delete, `git update-ref -d refs/heads/<b> <recorded-sha>`, which git refuses on mismatch. Today the port has `deleteRemoteBranch(branch, expectedTip)` and no local equivalent; add `deleteBranch(branch, expectedTip)`.
- **Record provenance:** the record must carry the repository identity (`git rev-parse --git-common-dir` realpath), the default branch and the `origin/<default>` SHA it read, and a timestamp. `--yes --plan` refuses a record from another repository and a record older than a bound (`Checks wait` is the existing config key of the right size). Branch names coincide across clones, so without the identity check a record from clone A deletes in clone B.
- **Scope:** the plan covers branches only. The worktree kind re-asks `prMerged` (`reap.ts:783-791`), and under `--yes` it removes worktrees and deletes given-up branches. Cause 2 makes the kinds dependent, so a branch-only record leaves the ordering hole open. The record must cover every kind the run acts on: worktrees, branches and claims. At minimum, a branch that the record shows as `keep — checked out` must stay kept even when the worktree kind freed it in the same run.
- **Slice 3 as written protects nothing (see a5).** A rate limit cannot produce `merged`. Two defects are real instead: `miss_or_unknown` reports `not-merged` from a failed call with empty stderr, and the branch kind has no tip-to-merged-head check (a3). Reframe the slice around those two, or drop it.
- **Reversibility:** use `refs/plot/reaped/<branch>/<sha>` rather than a log. A ref keeps the objects through `gc`, and `git branch <b> refs/plot/reaped/...` restores the branch. The namespace is unused today (grep found 0 hits in `skills/` and `packages/*/src`). The default refspec does not push it. `listBranches` must not read it, and the plan should name who prunes it, for example the reap itself after N days.

## (c) Slices

- Ship **"record the deleted tip"** first. It is independent, small, and makes every other mistake recoverable. Its `<!-- waits -->` dependency is on nothing.
- Add a slice, or file a separate bug that ships first: **the branch kind refuses a branch whose local tip is not reachable from a merged PR's head and not contained in `origin/<default>`**. It reuses `prMergedHeads` as the worktree kind does (`reap.ts:447`), with a new `LocalBranchReadings.unpushed` field. This is the only path the repro shows that loses data the dry run displayed as safe.
- The "acts on the approved set" slice should cover all kinds or state the ordering rule from (b). It should also include the count fix only after a measurement.
- Slice 3 does not need to wait for slice 1. If it is reframed as the `miss_or_unknown` fix, it belongs to the host adapter, not to the reap entry.

## (d) Open questions

- *Recorded plan or confirm in place?* Recorded plan, with intersection semantics. A confirmation in place still re-reads between print and act unless it acts on the printed values, and it then needs the same tip-pinned delete anyway.
- *Log or `refs/plot/reaped/*`?* The ref (see b). A log does not survive `git gc --prune`.
- *Does the host port report rate-limited answers to `prMerged`?* Partly. `host-shell.ts:306-323` maps exit 3 to `unknown` and records a refusal (`lastRefusal`). But `miss_or_unknown` turns a failed call with empty stderr into `not-merged`, which is indistinguishable from a real answer. For reap safety this direction keeps the branch, so it is not a deletion path.
- *Do the worktree and claim kinds share the divergence?* Yes. The worktree kind re-asks the host (`reap.ts:788`) and, under `--yes`, changes the branch kind's `checkedOut` input (cause 2, reproduced). The claim kind deletes via `deleteBranch` (`reap.ts:1171`) with no record or tip pin. Its readings are local and plan-file based, so it diverges only when plans or refs move between the runs.
- *Should `--yes` with no `--plan` still run?* Make it refuse unless `PLOT_UNATTENDED` callers pass an explicit `--plan` or a flag such as `--decide-now`. Otherwise the issue's exact path stays the default.
- New: should the record bound its age, and with which key? Should `--max` apply to the record's rows or to the fresh rows? Today `--max` counts `swept`, which moves with the readings.

## (e) Tests

- **Domain unit (vitest, `packages/domain`):** the intersection rule: a record `would` plus a fresh `no-merged-pr` gives keep; a record `keep` plus fresh merged gives keep; a moved tip gives keep; a foreign repository identity gives refuse. Also `branchSweepProblems` with an `unpushed` reading gives a refusal.
- **Contract (`test/reconcile/`, same harness as `reap-failed-readings.test.mjs`):** port `repro.mjs` as three tests: (1) a host flip between the runs deletes nothing the dry run kept; (2) a desk reaped in the same `--yes` run leaves its branch, because the record said `checked out`; (3) a merged-name branch with a local commit after the merged head is kept. Also: each deleted branch has a `refs/plot/reaped/*` ref at its old tip; and a branch moved between the runs is refused by `update-ref` (simulate by committing between the runs).
- **Counts:** a test that parses all sections and asserts `branches_deleted` equals the number of `deleted` rows in the branch section, and that `branches + branches_kept` equals the number of listed branches when a delete fails (`deleteRefusedFor` fixture).

## Amendments

1. Add cause 2 (`runWorktreeKind` frees branches before `runBranchKind` reads `checkedOut`, `reap.ts:1268-1269`, `:990`) to the Motivation, and make the record cover every kind or keep a branch the record kept.
2. Add a slice or prior bug: the branch kind must compare the local tip with the merged PR heads (`prMergedHeads`) as the worktree kind does. Today `--yes` and `--dry-run` both delete local-only commits on a reused branch name (reproduced).
3. Change "deletes exactly those refs" to "deletes the intersection of the record and a fresh gate" in the domain, so the deleted set is always a subset of the approved set.
4. Pin each local delete atomically (`git update-ref -d refs/heads/<b> <sha>`) through a new `deleteBranch(branch, expectedTip)` port signature, rather than check-then-`branch -D`.
5. Give the record its repository identity, default-branch SHA and timestamp. Refuse a foreign or stale record.
6. Reframe slice 3. A rate limit cannot yield `merged` (`plot-host.sh:4238/4257`, `:658`). Fix `miss_or_unknown`'s empty-stderr `not-merged` in the host adapter, or drop the slice.
7. Correct approach item 4: `branches_deleted` already equals the `deleted` rows of its section. The overcount is `swept` + `kept` on a failed delete (`reap.ts:1042`, `:1054`). Measure the issue's 37/37 before you name the fix.
8. Reorder: "record the deleted tip" first and independent. Choose `refs/plot/reaped/*` and name who prunes it.
