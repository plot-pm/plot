# plot-reap --yes deletes a different set than its --dry-run showed

> `plot-reap --yes` re-decides every local branch instead of acting on the set `--dry-run` showed, so the operator approves one set and the run deletes another. The reaper also keeps no record of a deleted tip, prints a host that could not answer as "no merged PR", and deletes commits added after a merge.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** follow-ups-2-29-1
- **Issue:** #2825
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- `plot-reap --yes` pins every local branch it deletes under `refs/plot/reaped/<branch>`, which `git gc` keeps, and prints a restore command on each `deleted` row. A later run removes reaped refs older than 30 days.
- A branch whose merge state the host could not answer, or answered while rate-limited, prints as its own `keep` reason instead of "unlanded work — no merged PR".
- `plot-reap` keeps a local branch that carries commits added after its merged pull request, and deletes a branch as "merged into <default>" only when the branch had commits of its own.
- `plot-reap --yes` deletes only what the recorded `--dry-run` showed and a fresh local check still allows. It refuses a record from another checkout or an old record, and the dry run shows a branch that this run frees by removing its desk.
- `plot-reap --sweep-temp --yes` runs as before, with no record.

<!-- Board impact: none expected. The board does not parse reap rows. The record is a new file under the common git dir; the plan format, the template and the docs/plans layout stay unchanged. -->

## Motivation

Issue #2825 reports one run on ewz-kus-portal (Plot 2.29.0, Bitbucket, account rate-limited, see #2815). `plot-reap.sh --dry-run` listed the branches it would delete, and the operator bundled exactly that set before approving. `plot-reap.sh --yes` then deleted a different set:

| branch | dry run | `--yes` run |
|---|---|---|
| `migration-abw-rechnungsempfaenger` | keep — unlanded work, no merged PR | deleted — PR merged (squash) |
| `feature/EWZREL-9391`, `feature/EWZREL-9832-adds-http-headers` | not listed | deleted — merged into develop |
| 6 branches (e.g. `marc/magellan-integration`, `slice/EWZREL-9386`) | would — PR merged (squash) | kept |

Panel round 1 ran the shipped bundle against sandboxes and reproduced every row. `git diff v2.29.0 HEAD` on `reap.ts` and `sweepable.ts` is empty, so the citations below hold for the operator's version. `--dry-run` and `--yes` share `runBranchKind` (`packages/board/src/server/entry/reap.ts:980`) and split only at `:1043`, so each run decides every branch again. Four causes make two runs disagree or lose work.

**1. A host that cannot answer prints as "no merged PR".** Under a rate limit the host never invents `merged`: GitHub prints `merged` only from an answered list with a `mergedAt` (`skills/plot/scripts/plot-host.sh:4238`), Bitbucket only from an answered row with `state == "MERGED"` (`:4257`), and a failed call goes to `miss_or_unknown` (`:658`), which answers `not-merged` or `unknown`. The port maps exit 3 to `MergedAnswer 'unknown'` (`packages/domain/src/adapters/host/host-shell.ts:309-315`, `packages/domain/src/ports/host.ts:33`) and keeps the refusal kind, including `throttled`, in `lastRefusal()` (`host.ts:87-88`). `runBranchKind` reads only `merged` as true (`reap.ts:1005-1009`), and `firstBranchRefusal` takes a boolean `hasMergedPr` (`packages/domain/src/rules/sweepable.ts:38,73,99`), so `unknown` prints as "unlanded work — no merged PR" (`reap.ts:1022-1023`). The `migration-abw` dry-run `keep` was a degraded answer and the `--yes` `PR merged` the true one; the 6 `would → kept` rows are the same mechanism in reverse. Both outcomes keep the branch, but the operator cannot tell a degraded answer from a real one.

**2. The worktree kind frees branches for the branch kind in the same run.** `runReap` runs the worktree kind first (`reap.ts:1268-1269`). Under `--yes` it removes a landed desk (`:902`) and keeps its branch unless the desk was given up (`:910-912`). The branch kind then lists checkouts again (`:989-992`), finds the branch free and deletes it. Under `--dry-run` nothing is removed, so the same branch prints `keep — checked out in a worktree`. No host answer is involved; three jurors reproduced it, and it matches the `feature/EWZREL-*` rows.

**3. Each run fetches the default branch.** `runReap` calls `ctx.fetch(defaultBranch)` (`reap.ts:1245`), so `origin/<default>` can move between the dry run and `--yes`, and `refs.contains` (`:1000`) turns `yes` for a branch that landed in between.

**4. A commit added after the merge is lost.** The branch kind deletes on "a PR on this branch name merged" and never compares the local tip with the merged PR's head. The worktree kind does compare them (`unpushedCommits`, `prMergedHeads`, `reap.ts:435-462`). A sandbox branch with one commit after its merged head printed `would` and was deleted, and the commit exists on no remote. Containment has a second false case: a branch with no commits of its own reads as contained (`merge-base --is-ancestor` exits 0) and is deleted as "merged into develop". The ancestry marker at `packages/domain/src/adapters/refs/refs-git.ts:763-765` licenses a caller that sends a `yes` on to the host, but reap decides deletion from it (`reap.ts:784,1001`), and `scripts/check-ancestry-decisions.sh` cannot see `Refs.contains` consumers.

**No deletion is recorded.** `deleteBranch` runs `git branch -D` (`packages/domain/src/adapters/trees/trees-git.ts:486-487`) and discards the tip it prints. The reaper deletes local branches at three sites: the worktree kind's given-up arm (`reap.ts:911`), the branch kind (`:1048`) and the claim kind (`:1171`). The operator recovered the tips only by pinning every dangling commit by hand, and the issue cannot rule out cause 4 for `migration-abw`. `skills/plot/scripts/README.md:49` still says "Branches and refs are untouched".

**The summary counters are correct as designed, and they read wrongly.** `branches_deleted` increments only beside a `deleted` row (`reap.ts:1049-1051`). `branches=` counts swept branches (would, deleted and FAILED), so a FAILED row counts in both `branches=` and `branches_kept=` (`:1042,1054`). The worktree kind's given-up delete (`:911`) is reported inside a worktree row and never reaches `branches_deleted`, and the claim kind prints its own `deleted` rows (`:1173`). The issue's totals add up (38 + 18 = 37 + 19 = 56), so no delete failed in that run.

## Design

### Approach

The decision stays in the domain, per *The Layering Rule* in `CLAUDE.md`: the reap entry passes readings as values, and pure rules in `packages/domain/src/rules/sweepable.ts` answer whether a branch, or a recorded row, may go. Record I/O lives in the entry or an adapter, never in `rules/`.

**Slice 1 — every deleted tip is pinned.** Before each local delete, at all three sites (`reap.ts:911,1048,1171`), the reaper writes the tip to `refs/plot/reaped/<branch>` and records when it wrote it. `git gc` keeps objects that a ref reaches, and the default refspec does not push `refs/plot/*`. Each `deleted` row prints its restore command, for example `restore: git branch <branch> refs/plot/reaped/<branch>`. The next run deletes reaped refs older than 30 days. The delete itself stays `git branch -D`, which refuses a checked-out branch; `git update-ref -d <ref> <old>` deletes a branch checked out in a worktree (exit 0, measured), so pinning the tip never replaces the checked-out refusal. `listBranches` does not read `refs/plot/reaped/*`. The slice corrects `skills/plot/scripts/README.md:49` ("Branches and refs are untouched"), which the branch and claim kinds already make false and the new reaped refs contradict further.

**Slice 2 — an unknown host answer is its own reason.** `LocalBranchReadings` carries the host answer as `MergedAnswer` (`merged | not-merged | unknown`) instead of a boolean, and the entry passes `lastRefusal().kind` when the answer is `unknown`. `branchSweepProblems` returns `host-unknown` (or `host-throttled`) for that reading, and the row reads `keep — the host could not answer` (with `rate-limited` where the refusal was `throttled`), never "unlanded work — no merged PR". The port already exposes both readings, so no adapter changes. The branch is still kept.

**Slice 3 — commits after the merge stay.** The branch kind reuses the worktree kind's guard (`prMergedHeads`, `unpushedPatches`, `reap.ts:435-462`): a branch whose local tip is past every merged PR head, with patches not on `origin/<default>`, is kept with its own reason. `hasMergedPr` splits into a host answer and a containment answer. Containment deletes a local ref only when the branch had commits of its own; a branch with none is kept. The slice amends *One Answer To "Did This Land"* (`CLAUDE.md:578`), which says a destructive decision reads the host's `mergedAt` and nothing else, to name this exception: containment may delete a **local ref**, because slice 1 pins its tip, and never a remote ref, a desk or a phase. It also corrects the `refs-git.ts:763-765` marker so it names reap's use, or adds a reap-side declaration.

**Slice 4 — `--yes` acts on the recorded dry run.** `--dry-run` writes a record under the common git dir: the repository identity (the realpath of `git rev-parse --git-common-dir`), the default branch and the `origin/<default>` SHA it read, a timestamp, and one row per worktree, branch and claim it would act on, each with its tip and reason. `--yes` deletes the intersection of the record's rows and a fresh local check: the tip is unchanged, the branch is not checked out now (read live, never from the record), and it is not the default branch. A host flip or a removed row can only remove deletions. `--yes` refuses a record from another checkout and a record older than a bound, and with no record it prints the `--dry-run` command and acts on nothing. The dry run projects the cascade of cause 2: a branch held only by a desk this run removes prints `would — merged into <default>, held only by a desk this run reaps`, and the record carries it. `--sweep-temp --yes` needs no record, because fleetd runs it hourly (`skills/plot/units/com.plot-pm.fleetd.plist:36`, `skills/plot/units/plot-fleetd.service:58`); no other caller runs `--yes` unattended. The CLI gains no per-branch `--only` flag: removing rows from the record narrows a run, and adding rows cannot widen it. A pure domain function answers whether a recorded row is still actionable: `(recorded row, current tip, checked out now, default branch) → delete | keep(reason)`.

### Tests

- **Slice 1.** Board unit: export `runBranchKind` as `runWorktreeKind` already is (`reap.ts:670`), drive it with a fake `Context` (pattern: `packages/board/test/unit/reap-given-up-desk.test.ts`), and assert that the reaped-ref write precedes `trees.deleteBranch` and carries the pre-delete SHA. Contract: in `test/reconcile/sweep.test.mjs`, after `--yes`, `git rev-parse refs/plot/reaped/<branch>` equals the old tip and still resolves after `git gc --prune=now`; one test per delete site (`reap.ts:911,1048,1171`). The printed restore command recreates the branch at that SHA. A reaped ref older than 30 days is gone after the next run, and a younger one stays.
- **Slice 2.** Domain unit (`packages/domain/test/sweepable.test.ts`): `branchSweepProblems` with an `unknown` host answer returns `host-unknown`, not `no-merged-pr`. Contract: a `gh` stub that answers 429 for one branch; its row reads `keep — the host could not answer` and does not match `/unlanded work/`. `test/reconcile/reap-failed-readings.test.mjs:128` (a stub answering `[]`, so `not-merged`) and `sweep.test.mjs:217` ("an unreachable host deletes nothing") stay green.
- **Slice 3.** Domain unit: a merged answer with a tip past every merged head and patches not on default gives a keep reason; containment with no commits of the branch's own gives a keep reason. Contract: a scratch repo with a squash-merged branch plus one later commit; `--yes` keeps it and the commit stays reachable from `refs/heads/<branch>`.
- **Slice 4.** Domain unit: the record-row rule refuses a moved tip, a branch checked out now, the default branch, a foreign repository identity and an old record. Contract: the panel's reproduction as a test — `--dry-run`, flip the `gh` stub, push one branch to `origin/main`, `--yes`, and assert that the deleted set is a subset of the dry run's `would` rows; a branch committed to after the record is refused by name; a branch checked out in a new worktree after the record survives; a hand-removed row is kept. Board unit: a landed clean desk on a merged branch; the dry run's branch row names the cascade, and `--yes` deletes exactly that row. Characterisation (passes today, keep it): `branches_deleted` equals the count of `deleted` rows in the branch section. `--sweep-temp --yes` with no record still runs.
- No browser tier: the board renders no reap rows.

### Decisions

Decided 2026-10-28 by Jan Wloka after panel round 1 (`.plot/panels/2026-10-28-plot-reap-yes-deletes-a-different/panel.md`):

- [x] The plan carries four slices, in this order: recoverability, the unknown host answer, commits after the merge, the recorded dry run.
- [x] Recoverability ships first: `refs/plot/reaped/<branch>` at all three delete sites (`reap.ts:911,1048,1171`), a restore command per `deleted` row, and a 30-day prune on the next run. The checked-out refusal stays, because `git update-ref -d <ref> <old>` deletes a checked-out branch.
- [x] Reaped tips go to a ref, not a log: a ref keeps the objects through `git gc`, and a log does not.
- [x] A host answer of `unknown` or `throttled` is its own reading and reason (`reap.ts:1022`, `sweepable.ts:73`). This replaces the earlier slice that downgraded a merged verdict made under a rate limit: the panel showed that a rate limit never produces `merged` (`plot-host.sh:658,4238,4257`).
- [x] The host port already reports a degraded `prMerged` answer, as `MergedAnswer 'unknown'` (`host.ts:33`) and `lastRefusal().kind` (`host.ts:87-88`). The reap entry ignores both today; no adapter slice is needed.
- [x] The branch kind refuses a tip past the merged PR's head, reusing `prMergedHeads` and `unpushedPatches` (`reap.ts:435-462`). Containment deletes a local ref only for a branch with commits of its own. `hasMergedPr` splits into a host answer and a containment answer, and slice 3 amends `CLAUDE.md`'s *One Answer To "Did This Land"* to name the local-ref exception.
- [x] A recorded dry run, not a confirmation in place. `--yes` acts on the record intersected with a fresh local check (tip unchanged, not checked out, not the default branch). The record carries the repository identity, the default-branch SHA and a timestamp, and covers worktrees, branches and claims; a record from another checkout or too old is refused.
- [x] The worktree and claim kinds share the divergence: the worktree kind re-asks `prMerged` (`reap.ts:783-791`) and frees branches for the branch kind (cause 2); the claim kind re-reads refs after the fetch (`reap.ts:1135-1144`) and deletes at `:1171`. The record covers all three kinds, and the dry run shows the cascade.
- [x] `--yes` with no record acts on nothing, except `--sweep-temp --yes`, which fleetd runs hourly. No per-branch `--only` flag.
- [x] The counter theory is dropped: `branches_deleted` already equals the branch section's `deleted` rows.

### Open Questions

- [ ] Read `MERGED` rows from the PR index before asking the host (*A Decision Reads The Index*)? It would make the dry run itself stable under a rate limit and save one host call per branch, and it needs its own paragraph in `CLAUDE.md`. Not chosen now; measure first whether ewz-kus-portal's Bitbucket index carries MERGED rows.
- [ ] Another reaper between the dry run and `--yes` (fleetd's hourly `--sweep-temp --yes`, or a second operator) is a case no juror considered. The fresh local check covers a moved or deleted branch; what the record does when another run already deleted, pinned or pruned its rows is unspecified.
- [ ] A hand-added `PR merged` row at a branch's current tip passes the local check. Does `--yes` re-ask the host for such rows (any answer but `merged` keeps the branch), or does the record carry a checksum the reaper verifies?
- [ ] Which bound makes a record too old: `Checks wait`, or a new key?
- [ ] Which reading says a contained branch "had commits of its own"? The proposed reading is a tip off the first-parent line of `origin/<default>`; a repository that merges by fast-forward then keeps every contained branch, which is the safe direction.
- [ ] Reaping the same branch name twice overwrites `refs/plot/reaped/<branch>`. Is the earlier tip's loss acceptable, or does the ref name carry the SHA?
- [ ] Does `--max N` apply to the record's rows, or refuse with a record? Does a FAILED row stop counting in `branches=`?

## Slices

### Recoverable deletes

- `bug/plot-reap-pins-every-tip-it-deletes` — write `refs/plot/reaped/<branch>` before each local delete at `reap.ts:911,1048,1171`, print a restore command per `deleted` row, prune reaped refs older than 30 days, keep the checked-out refusal, correct `skills/plot/scripts/README.md:49` <!-- builds: refs/plot/reaped/<branch> and its 30-day prune -->

### Unknown host answers

- `bug/plot-reap-names-an-unknown-host-answer` — `LocalBranchReadings` carries `MergedAnswer` and the refusal kind; `unknown` and `throttled` print their own `keep` reason instead of "unlanded work — no merged PR"

### Commits after merge

- `bug/plot-reap-keeps-commits-after-the-merge` — the branch kind refuses a tip past every merged PR head (`prMergedHeads`, `unpushedPatches`); containment deletes only a branch with commits of its own; split `hasMergedPr`; amend *One Answer To "Did This Land"* and the `refs-git.ts:763` marker

### Recorded dry run

- `bug/plot-reap-yes-acts-on-the-recorded-run` — `--dry-run` writes a record of worktrees, branches and claims with repository identity, default-branch SHA and timestamp; `--yes` deletes the record intersected with a fresh local check; the dry run shows the worktree-then-branch cascade; `--sweep-temp --yes` needs no record <!-- builds: the reap record under the common git dir -->

## Notes

- Related: #2807, #2815, #2730.
- Source: tracker issue #2825. The plan writes nothing to the tracker.
- The four slices are four waves and gate in merge order. Slices 2, 3 and 4 all change `runBranchKind` and `sweepable.ts`, and the wave order keeps them from running at the same time.
- Amended 2026-10-28 after panel round 1.
