# Auto-deliver re-delivers a rejected plan whose slice PR carried only its claim

> Fleetd's auto-deliver holds an Approved plan that carries a `Rejected:` record, and holds a plan whose merged slice gave the default branch no file outside a `PLOT-BLOCKED` marker; a person delivers both.

## Status

- **State:** Approved
- **Type:** feature
- **Issue:** #2713
- **Rounds:** 1
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-27, Jan Wloka, plan-PR #2760 merged

## Changelog

- Fleetd's auto-deliver no longer delivers an Approved plan that carries a `Rejected:` record, and no longer delivers a plan whose merged slice PR changed no file outside a `PLOT-BLOCKED` marker. A person delivers such a plan with `/plot-deliver`, which keeps its current behaviour.

<!-- Board impact: no pulse field, no plan field, no schema change and no rendering change. Slice 2 moves the carried-work classification from packages/board/src/server/controllers/deliverability.ts into a domain rule; the board's deliverability controller calls that rule with byte-identical behaviour. The board shows no hold state in this plan. -->

## Motivation

### The incident

On 2026-10-26, `/plot-reject` moved `plot-host-bitbucket-pr-list-reads` (#2400) from Delivered to Approved at 14:38:04 UTC (`6666041ff`). Fleetd's auto-deliver delivered it again at 14:38:47 UTC (`c67b5cd1f`), 43 seconds later. On `origin/main` the plan file reads `State: Delivered` and holds a `Rejected:` record above a second `Delivered: 2026-10-26`, the index symlink is back in `delivered/`, and the sprint item in `2026-W43-bugfix-2-28-2.md:31` is ticked again.

The plan's only branch has PR #2422 merged at 14:19:47 UTC (merge commit `eede90c78`). The PR holds two empty commits: the claim `d92e323f9` and the blocker commit `f576060de` ("No code change follows"). `gh pr view 2422 --json files` returns zero files, and `git show -m --first-parent --name-only eede90c78` lists no file. `bb_state_listing` on `origin/main` still reads one page. The first delivery (`b2df79eaf`, 14:21:07 UTC) came from the same auto-deliver path. Both deliveries came from fleetd's `runAutoDeliverPass` (`packages/fleet/src/shared/auto-deliver.ts:496`), as the deliver log `.worktrees/plot-deliver-plot-host-bitbucket-pr-list-reads.log` shows.

Effect: the next release publishes #2400's Changelog line for a change that is not on main. The paging now belongs to slice 1 of `read-merged-prs-from-the-merge` (#2419).

### The two defects

1. **No rejection input.** `isDeliverable` (`packages/domain/src/rules/auto-deliver.ts:340-395`) checks phase `approved`, no in-flight mark, `allSlicesConfirmed`, `landedBranches > 0` and `retryVerdict`. A pulse plan carries only `file`, `phase`, `tracer` and `slices` (`packages/domain/src/entities/fleet.ts:695-722`). No input separates an Approved plan that never delivered from one a person just rejected. `planAutoDeliver`, run from source against #2400's pulse row with phase `approved`, returns the plan.
2. **No carried-work input.** Auto-deliver counts a merged slice PR as delivered work whatever it changed. The board and `/plot-deliver` already measure this: `carriedWorkOf` (`packages/board/src/server/controllers/deliverability.ts:211-238`) reads the merge commit's first-parent files and ignores a root `PLOT-BLOCKED*` marker, and `emptySlices` (`packages/domain/src/workflows/deliver.ts:113-114`) names such a branch. The deliver log shows that `emptySlices` named `bug/plot-host-bitbucket-pr-list-reads` on both runs. The finding does not stop a delivery, by the decision recorded at `workflows/deliver.ts:92-110`: of 60 merged PRs measured on 2026-09-08, seven carried no work, and three of those were claim PRs whose slice finished under a different PR.

`isEmptyClaim` (`packages/domain/src/rules/empty-claim.ts`) is not the predicate. `f576060de` has a tree equal to its parent's tree, but its subject is not `plot: claim …`, so `isEmptyClaim` answers false and `realCommits` counts #2422 as work.

### The upstream cause

`/plot-reject` (`skills/plot-reject/SKILL.md:96-112`) edits the plan by hand. Its step 3 warns when every non-deferred branch merged, which is this case. It does not call `plot-undeliver.sh`, and that script's `refs-swept` refusal parses `(Branch: …` (`plot-undeliver.sh:79`), which current `## Slices` lines do not contain, so the refusal never fires. Issue #2764 holds this defect. It is out of scope here.

### Precedents

Two plans in `docs/plans/` read Approved again after a `Rejected:` record and delivered again:

| Plan | Hollow PR | Rejection | Fix PR | Second delivery |
|---|---|---|---|---|
| `a-lifecycle-micro-pr-merged-past` | #1816, 2026-10-16T00:40:21Z, 0 files | `e32076f61`, 2026-10-16T01:23:38Z | #1823 under the new slice heading `### Identities (build)`, 2026-10-16T05:57:25Z, 16 files | `6bb657b37`, correct |
| `plot-host-bitbucket-pr-list-reads` | #2422, 2026-10-26T14:19:47Z, 0 files | `6666041ff`, 2026-10-26T14:38:04Z | none; the work moved to #2419 | `c67b5cd1f`, wrong |

Both precedents fall on one calendar day each. A `Rejected:` record carries a date and no time, so a date comparison cannot separate the hollow merge from the fix: `>` holds row 1 until a later-day merge, and `>=` re-delivers row 2.

## Design

### Approach

1. **Rejection hold.** Auto-deliver holds a plan whose phase is `approved` and whose Status block carries any `Rejected:` line. A person delivers it. No later merge lifts the hold. "Rejected" never means "the latest Status record": `plot-undeliver.sh:117-157` inserts `Rejected:` after `State:` and keeps the `Delivered:` line, so the last record by position is `Delivered:` after that writer. A plan that delivers again reads `delivered`, so phase plus any `Rejected:` line proves a reversal that no person has delivered since.
2. **Claim-only hold.** A merged, non-deferred slice is claim-only when its merge commit's first-parent diff (`Host.prMergeCommit`, then `Refs.commitFiles`) changes no path other than a root `PLOT-BLOCKED*` marker. Auto-deliver holds a plan with any claim-only slice. Slice 2 moves `carriedWorkOf`'s classification (`isMarker` and "any path outside it") from the board controller into a domain rule in `packages/domain/src/rules/`, and both the board controller and the fleet call it. The implementation never uses `Refs.changedFiles` (a three-dot diff, empty for every branch after a true merge) or `isEmptyClaim`, `realCommits` or `Trees.commitBeyondClaim` (they count `f576060de` as work).
3. **Auto-only.** Both holds sit beside the `landedBranches` gate (`auto-deliver.ts:370-389`), whose comment states the precedent: this path runs unattended and chains to a reap and to `plot-release-refs.sh --yes`, and an automatic path does not resolve a question a person was asked. `allSlicesMerged`, `allSlicesConfirmed`, the scan's slice verdict, the board's Deliver control and `/plot-deliver` stay unchanged. `/plot-deliver` keeps the 2026-09-08 `emptySlices` decision: it names the branch and delivery continues.
4. **Readings from the adapter.** The pulse gains no field. `runAutoDeliverPass` takes both readings for the candidates that `planAutoDeliver` returns, and for no other plan. It reads the plan file through `PlanStore.readPlan` for the `Rejected:` line, and it reads each merged, non-deferred branch's merge commit files through the `Host` and `Refs` ports. It passes both readings to the domain rule as values. A merge commit is terminal, so the pass caches the carried-work answer per merged branch for the life of the process. This adds no shell lines and no helper script.
5. **A hold is a skip.** A held candidate gets no in-flight mark and no failure record, and it never reaches `AUTO_DELIVER_MAX_FAILURES` or the "failed 3 consecutive deliveries" report. Fleetd logs one line naming the plan and the reason (`rejected`, `claim-only <branch>`, or `unknown`) when it first holds a plan.
6. **Every `unknown` holds.** An unreadable plan file, a missing merge commit, an empty merge-commit answer, a failed `commitFiles` read, a cross-repo slice and a commit-named slice (`→ owner/repo@sha`) each hold the plan. An `unknown` never counts as carried work.

### What a person sees

A plan held by either rule waits for a person. The board still shows it deliverable, and `/plot-deliver` delivers it. This includes a legitimately re-approved plan whose fix merged after the rejection: row 1 of the precedent table would wait for a person under this plan, because its hollow `### Identities` branch is non-deferred and claim-only, and because it carries a `Rejected:` line. That cost is accepted: the plan waits, and nothing is deleted. A repair that lets auto-deliver resume for a claim-only branch whose work landed under a sibling slice is to defer that branch with a reason that names the sibling. A docs-only slice is work: a merge commit that changes only `docs/…` files carries work, and the claim-only hold does not fire.

### Corpus

No corpus pair arises. No shell implementation of carried work exists, and `plot-open-pr.sh:227` only reads the domain's notice. `packages/domain/corpus/deliverable.corpus.test.ts:20-35` already excludes `planAutoDeliver` from the equality as the stricter reader. Each slice adds one line to that exclusion comment that names its hold.

### Tests

Slice 1 (`packages/domain/test/auto-deliver.test.ts` for the rule, `packages/fleet/test/unit/auto-deliver.test.ts` for the pass):

- **Fails today:** a plan at phase `approved`, every slice merged with host evidence and landed, and a Status block in the `/plot-reject` layout (`Rejected: 2026-10-26 (…)` in place of `Delivered:`), with #2400's timings (merge 2026-10-26T14:19:47Z, rejection 2026-10-26). No delivery. Today's code delivers it.
- **Fails today:** the same plan in the `plot-undeliver.sh` layout (`Rejected:` after `State:`, `Delivered:` kept below). No delivery.
- **Fails today:** a re-approved plan with a `Rejected:` line and a real merge after the rejection (row 1's shape: 16 files, merged 2026-10-16T05:57:25Z). No delivery; the log names `rejected`.
- **Fails today:** a `Rejected:` line followed by a later `Started:` record. No delivery.
- **Opposite case:** an Approved plan with no `Rejected:` line delivers as today.
- **Opposite case:** a plan at phase `delivered` with a `Rejected:` line is not a candidate, as today.
- **Unknown:** an unreadable plan file holds.
- **Skip:** after five passes over a held plan, the in-flight record holds no mark and no failure for the slug, and no "failed … consecutive deliveries" line appears.

Slice 2 (a domain unit test for the classification rule, the pass test, and the existing board `deliverability` tests unchanged):

- **Fails today:** #2422's shape: an empty `plot: claim` commit plus an empty non-claim commit, a merge commit whose first-parent diff lists no file. The plan holds. A rule built on `isEmptyClaim` or `realCommits` delivers this fixture, so the fixture separates the right reuse from the wrong one.
- **Fails today:** a merge commit whose first-parent diff lists only `PLOT-BLOCKED.md`. The plan holds.
- **Opposite case:** one real source file delivers.
- **Opposite case:** only `docs/notes.md` delivers; a docs-only slice is work.
- **Opposite case:** a true merge whose branch tip equals its merge base and whose first-parent diff lists real files delivers. This catches a three-dot `Refs.changedFiles` reading.
- **Swept ref:** a merged branch whose remote ref is gone is read through its merge commit and answers from that commit's files, never `unknown` for the missing ref alone.
- **Unknown:** a failed `prMergeCommit`, an empty merge-commit answer and a failed `commitFiles` each hold.
- **Cache:** a second pass over the same merged branch asks `prMergeCommit` and `commitFiles` zero more times.
- **Manual path unchanged:** the board's `deliverability` still names the branch in `emptySlices` and delivers.

### Open Questions

- [x] Does "until a branch merges after that date" compare `mergedAt` or the record's date? — Neither. A rejected plan is never auto-delivered; a person delivers it. A date-only record cannot order a same-day merge and rejection, and both precedents are same-day. Operator decision, panel round 1.
- [x] Does a claim-only slice block delivery or count as not merged? — It holds the auto path only. It does not re-open the slice and does not change `allSlicesMerged`, the board or `/plot-deliver`. Operator decision, panel round 1.
- [x] Does `/plot-deliver` gain the same checks? — No. Both holds are auto-only, beside `landedBranches`. `/plot-deliver` keeps the 2026-09-08 `emptySlices` decision. Operator decision, panel round 1.

## Slices

### Rejection hold

- `bug/auto-deliver-holds-a-rejected-plan` — `runAutoDeliverPass` reads each candidate's plan file through `PlanStore` and a domain rule holds a plan at phase `approved` with any `Rejected:` line, as a skip with no mark and no failure record; an unreadable file holds; one exclusion-comment line in `deliverable.corpus.test.ts`; tests: both reject layouts with #2400's same-day timings, a later real merge, a later `Started:`, no `Rejected:` delivers, five held passes leave no failure record.

### Claim-only slice

- `bug/auto-deliver-ignores-a-claim-only-slice` — the carried-work classification moves from the board's `deliverability.ts` into a domain rule that board and fleet both call; `runAutoDeliverPass` reads each candidate's merged, non-deferred branches through `Host.prMergeCommit` and `Refs.commitFiles`, caches the answer per merged branch, and holds a plan with a claim-only or `unknown` slice; one exclusion-comment line in `deliverable.corpus.test.ts`; tests: #2422's two-empty-commit shape and a marker-only diff hold, a real file and a docs-only file deliver, a tip-equals-merge-base merge delivers, `unknown` holds, the board's `emptySlices` path is unchanged.

## Notes

- Source: issue #2713 (https://github.com/plot-pm/plot/issues/2713). The issue is the problem statement; the plan's `Issue:` field is the only link and nothing is written to the tracker.
- This plan's panel, round 1: `.plot/panels/2026-10-27-auto-deliver-re-delivers-a-rejected/` (rootcause, code, safety, tests; unanimous amend). The operator chose the rejection hold with no lift over a `mergedAt` comparison, the merge commit's first-parent diff over `isEmptyClaim`, auto-only holds, and the adapter read over a pulse field.
- #2400 is still Delivered on `origin/main` with no code on main. The operator rejects it after slice 1 merges and fleetd runs that code, and before any release, then unticks its item in `2026-W43-bugfix-2-28-2.md:31`. A rejection before slice 1 lets fleetd re-deliver it within a minute, as on 2026-10-26.
- Out of scope: `skills/ralph-plot-sprint/SKILL.md:142` and `:239` run `/plot-deliver` unattended once every non-deferred branch merged, and they read neither hold. The Changelog names fleetd's auto-deliver only.
- Out of scope: `/plot-reject` edits the plan by hand, and `plot-undeliver.sh:79`'s `refs-swept` check never fires on current plans. Filed as #2764.
- Out of scope: a board state that names a hold. Fleetd's log line is the only report in this plan.
- New code in `packages/domain/**` and new fleet helpers are arrow functions.
