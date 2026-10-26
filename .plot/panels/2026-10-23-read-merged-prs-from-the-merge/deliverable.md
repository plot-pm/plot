# Juror: deliverable lens

Subject: `docs/plans/2026-10-23-read-merged-prs-from-the-merge.md` (Draft, #2385).

Method: every claim below comes from reading the file at the cited line. The commands I ran were read-only `grep`, `sed -n` and `cat` over the worktree. I ran no tests and no bundles, and I made no host calls, so none of these claims is backed by an execution.

## 1. The Changelog's board claim is not reached by the slice

The Changelog (plan:15) promises that "the board no longer shows a delivered plan as *state unknown*". I traced that sentence back to its source:

- The note is written at `packages/board/src/server/fleet.ts:4292-4293` for `state === 'unknown'`. That state comes from `plot-fleet-scan.sh` readings, which pass through `plot-branch-state.mjs` (`plot-fleet-scan.sh:4141`) into `ownState` (`packages/domain/src/rules/branch-state.ts:226`).
- The scan's `pr` field comes from the scan's own `pr-list` cache (`HOST_STATE_CACHE`, `plot-fleet-scan.sh:1321-1351`) or from the scan's previous listing, which `fleet-scan.ts:418` carries in as `PLOT_PR_LISTING`. Neither reads the PR index store. Only `plot-impl-status.sh`, `plot-reconcile-scan.sh` and `plot-board-probe.sh` call `plot-pr-index-lookup.mjs` (grep over `skills/plot/scripts/*.sh`).
- `ownState` returns `unknown` in two arms:
  - A **refless** branch while the host is throttled (`branch-state.ts:259-266`). This arm already reads `mergeSubjectFound` first (`:247`), so a conforming Bitbucket merge subject already answers `merged` there.
  - A branch **with a ref** behind main, where the host was unreachable or the PR list was incomplete (`:310-325`). Bitbucket keeps the source branch unless the merge closes it, so this is the likely arm for the July plans. `mergeSubjectFound` is not consulted here, by design: "THE REF CHECK STAYS IN FRONT. DO NOT HOIST THE MERGE LOOKUP ABOVE IT" (`:227-237`).

So writing merged rows into the store does nothing to the board's branch state. The slice as written ends at "fold them into the PR index" (plan:49), and no observer of the Changelog's sentence reads that index. To reach the claim, the slice must also feed index MERGED rows into the scan's `pr` reading for branches that have a ref. That is the exact shape the reused-name guard forbids, because a subject keyed by branch name describes the earlier attempt. The plan must name that reader change and say how a PR **number** is joined, rather than a head, or the board half of the Changelog must be dropped.

I did not confirm which arm fired for the three July plans. That needs a read of ewz-kus-portal, which this panel does not have.

## 2. The one slice hides four deliverables

`feature/read-merged-prs-from-the-merge` (plan:49) bundles four changes:

1. **Merge-log reader.** This exists already. `Refs.mergeSubjects(ref, max)` is at `ports/refs.ts:659` and `refs-git.ts:744-750`, registryd calls it (`registryd-main.ts:628`), and the scan runs its own walk with a 2000-merge cap (`plot-fleet-scan.sh:472-483`). The plan presents the reader as new work, and its `builds:` marker names it as the deliverable. The actual new work is the step that turns subjects into PR rows.
2. **Fold and schema change.** `PrIndexRowSchema` is `.strict()` and requires `draft`, `checks`, `review` and `url` (`entities/pr-index.ts:30-90`). The entity forbids defaults and invented values (`:18-28`). A subject-derived row therefore needs new optional fields or a source marker, which means `PR_INDEX_VERSION` 5 → 6 (`:12`). Because the version is a literal, every old reader falls back to the host until the next write. A commit watermark for `<last indexed>..origin/<default>` (plan:31) also needs its own field: the existing `watermark` holds the host's `updatedAt` string (`:119-125`).
3. **Survival across a `whole` fold.** `foldPrIndex` starts empty on `whole` (`rules/pr-index.ts:147-153`). A truncated Bitbucket full read exits 0: the truncation notice goes to stderr only (`plot-host.sh:3049`), `scripts-shell.ts:99` turns exit 0 into `answered`, and `answerKind` turns that into `whole` (`pr-refresh.ts:1701`). Each daily full read would therefore erase every subject-derived row and set `complete: true` over 50 merged rows. The slice must say that subject rows are re-supplied on every fold, or that the fold keeps rows by source. The plan does not mention this. It is also an existing defect: today the store claims `complete` on a truncated read.
4. **Host-ask reduction.** `pr-refresh.ts:1477-1478` asks `pr-list --state all`. Asking only for open and declined PRs changes the arguments, the `PR_REQUESTS_PER_REFRESH` arithmetic (`bitbucket: 3`, `pr-refresh.ts:249`) and the partial/whole semantics. A listing without merged rows is no longer `whole`, so deletions are never seen.

Each of these needs its own test surface and has its own failure mode, so each should be its own slice. Item 4 also depends on #2386: the addendum asks that the open-PR asks run once per account.

## 3. Addendum coverage (#2385 comment)

| Addendum point | Covered? |
|---|---|
| List and single-PR GET are throttled separately (measurement) | No. Not cited in Motivation. |
| Seed once with a full paged walk | No. It depends on #2400 / agent-skills#98, and the plan names #2400 only as an overlap question (plan:40). |
| Terminal rows written once, never re-asked | Partly. The plan covers merged rows only (plan:32). Declined rows are still asked (plan:33). |
| Open PRs as a watch list refreshed by `GET …/pullrequests/{id}` | No. Step 3 still means "ask the listing" for open PRs. |
| Discovery: one delta page, `sort=-updated_on`, `q=updated_on > last seen`, only when a fetch brought a new branch ref | No. A `--since` window exists already (`bb_window_listing`, `plot-host.sh:1310-1322`), but the fetch trigger and the one-page bound are absent. |
| Pair with #2386's single reader | Open Question only (plan:41). |
| `plot-approve` lookup made local (addendum "why it matters") | No. Sibling #2407 fixes only the refusal wording. |

## 4. Consistency with CLAUDE.md

- **One writer:** consistent, provided the merge-log rows enter through `pr-refresh.ts` → `foldPrIndex`. Approach step 2 says so. Open Question 1 can be closed: the answer is one store.
- **Only terminal answers are read:** consistent, because `isTerminalRow` requires MERGED and not draft (`rules/merged-row.ts:17-18`). A subject row must carry `draft: false`, which the merge commit does not state. That value is an inference, and the entity's own rule refuses inferred values (`entities/pr-index.ts:15-16`).
- **The index never says no:** the plan holds this (plan:42).
- **"Did this land":** this is the conflict. `plot-impl-status.sh` reads the store inside `/plot-deliver`, a destructive path, and resolves a branch through `mergedRowByHead`, which picks the lowest number (`merged-row.ts:21-25`). Subject rows would add every old merge under a reused name: `docs/domain/merge-subject.md:43` measures 87 reused names on one estate. Delivery would then accept an earlier attempt's merge as this slice's merge. That breaks `merge-subject.md:53-62` ("no destructive decision reads a subject"). Open Question 2 must be decided before approval, not in Design, because it decides whether the Changelog is reachable at all.

## 5. Changes before approval

1. Split the slice into named slices with one deliverable each: (a) subject → row with a source marker and a schema bump; (b) fold keeps subject rows across `whole`, and a truncated read stops claiming `complete`; (c) the scan's or board's branch-state reader takes index MERGED rows, joined by PR number; (d) the host listing drops the merged state, sequenced after #2386. Put the addendum's watch list and delta discovery in a fifth slice, or say they are out of scope.
2. Rewrite the Changelog so that each sentence names something a slice builds. "The board no longer shows … *state unknown*" stays only if slice (c) exists. Name the observer: `plot-fleet-scan.sh` → `branch-state.ts`.
3. Correct Approach step 1. The merge-log walk already exists (`refs-git.ts:744`, `plot-fleet-scan.sh:478`). Say what the slice adds to it.
4. Answer Open Question 2 in the plan. Subject rows either carry a source that `plot-impl-status.sh` and `/plot-deliver` refuse, or this plan amends *One Answer To "Did This Land"*. Close Open Questions 1 and 7 with the evidence above: one store, and an age rule that is per plan and cannot transfer to a row keyed by PR number.
5. State that the plan depends on #2400 for seeding. List the addendum points it leaves to later work.

Position: amend
