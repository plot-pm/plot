# Bitbucket: an old merged PR stops reading as no PR

> On Bitbucket the host lists one page of 50 PRs per state, and Plot records that page as the whole answer. This plan makes the PR index say when a listing may be short, makes the wave gate read the whole merge log, and makes delivery ask the host about each unresolved branch by name.

## Status

- **State:** Draft
- **Type:** feature
- **Issue:** #2385
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- On Bitbucket, a PR listing that may hold only the newest 50 PRs of a state no longer records the PR index as complete.
- The wave gate reads the default branch's merge log up to 20 000 merges instead of 2000, so a branch merged before the 2000th-newest merge reads as merged.
- On Bitbucket, `plot-impl-status.sh` asks the host about each unresolved branch by name instead of reading one page of merged PRs, so `/plot-deliver` finds an older merged PR.

<!-- Board impact: the scan's wave gate reads more merges, so a refless branch merged before the 2000th-newest merge moves from `open` or `unknown` to `merged`. The board's *state unknown* note for the three July plans in Motivation comes from HTTP 429 and does not change. No plan format, template or docs/plans layout change. -->

## Motivation

Measured 2026-10-23 on ewz-kus-portal (Plot 2.28.0, bb 1.11.2): `plot-host.sh pr-list --state merged --limit 1000` returns 50 rows and prints *"possibly truncated (50 rows, requested limit 1000 unprovable)"*. Three Delivered July plans show under *Not started* with *state unknown — the host's answer is incomplete*, while the board keeps hitting HTTP 429 (#333).

Read on `origin/main` at `3975b9768` (2026-10-26), the short listing is recorded as a whole one:

- `bb_state_listing` (`plot-host.sh:1393-1406`) asks one page of `pagelen=50` per state and never follows `next`.
- `pr_list_report_truncation` (`plot-host.sh:3250`) prints *possibly truncated* on stderr and returns 0. `pr_list_states` returns 0 when every state answered (`plot-host.sh:1544`).
- `scripts-shell.ts:99` maps exit 0 to `answered`. `answerKind` (`rules/pr-index.ts:90-95`) then returns the window's kind, a full read folds as `whole`, and `wholenessAfter` writes `complete: true` (`rules/pr-index.ts:268-269`).
- The Delivered plan `bitbucket-and-github-listings-read-one` (#2484) made `bb_branch_query`, `pr-merged-heads` and the `pr-review` arm follow `next`. It did not change `bb_state_listing`, which #2400 owns. #2400 is Approved and waits on agent-skills#98.

Delivery has the same gap. For a branch the PR index cannot answer, `plot-impl-status.sh:269` asks `pr-list --state merged --limit 500`. On Bitbucket that call returns one page of 50 rows. ewz-kus-portal holds 1770 `Merged in … (pull request #N)` subjects on `origin/develop`, so even a complete 500-row page misses most merged PRs.

The merge log is not the fix for the three July plans. Measured 2026-10-26 on ewz-kus-portal (read-only, `origin/develop` as fetched 2026-10-23): the Delivered plans `ewzkus-3518-invoice-aggregation`, `ewzkus-3711-sammelrechnungen-anzeige` and `ewzkus-3712-liegenschaft-suche` name slice PRs #3488, #3489 and #3490. No merge subject on `origin/develop` names these PRs or their branches. Their commits landed linearly on an integration branch, which merged as #3491. All 11 slice branches of the July plans have no ref on origin, so the scan reads them in the refless arm (`branch-state.ts:238-268`). That arm answers `unknown` only while the host is throttled (`branch-state.ts:259-267`). The *state unknown* note on those plans therefore comes from HTTP 429.

A Bitbucket merge commit carries the subject `Merged in <branch> (pull request #N)`. On ewz-kus-portal, `git log origin/develop --merges` reads 2340 merges in 0.02 s, and the scan's walk stops at 2000 (`plot-fleet-scan.sh:472`).

## Design

### Approach

1. **A short listing is a partial answer.** When `pr_list_report_truncation` calls a state *possibly truncated*, `pr_list_states` finishes the other states and then returns `PR_LIST_PARTIAL_RC` (7, `plot-host.sh:935`) with a stderr line that names the state. `scripts-shell.ts:111` already maps 7 to `partial` and keeps stdout. `answerKind` then returns `partial`, and `foldPrIndex` merges the rows and leaves `complete` as it was (`rules/pr-index.ts:268-271`). A store that a short listing built stays `complete: false`. The scan reads listing completeness from stderr (`plot-fleet-scan.sh:1265`), so the slice surveys every `pr-list` caller's handling of exit 7 before the change.
2. **The wave gate reads the whole merge log.** `MERGE_SCAN_LIMIT` (`plot-fleet-scan.sh:472`) and `MERGE_WALK_LIMIT` (`registryd-main.ts:599`) rise from 2000 to 20 000. The saturation report stays. Each scan walks the full log, with no cursor field. The walk feeds the wave gate only, and its reading is never written to the PR index.
3. **Delivery asks by name.** `plot-impl-status.sh:265-271` replaces its one `pr-list --state merged --limit 500` call with one `pr-list --state merged --branch <branch>` call per un-annotated branch that the index could not answer. On Bitbucket, `--branch` runs the per-branch REST query (`PR_LIST_BRANCHES`, `plot-host.sh:4786`), which follows `next` since #2573. On GitHub, one branch maps to `--head` (`plot-host.sh:4488`). The host's `MERGED` answer decides, as *One Answer To "Did This Land"* requires.

### Merge-Subject Rows

This plan writes no merge-subject row into the PR index, and `PR_INDEX_VERSION` stays 5 (`entities/pr-index.ts:12`). Three facts decide it:

- *Answers, never verdicts* (CLAUDE.md, *A Decision Reads The Index*): the index holds bought answers. A merge-subject reading costs 0.02 s of local git on the largest measured estate, so a stored copy is a cache that git can reach.
- Every reader of a terminal row decides something destructive or feeds such a decision. `pr-index-lookup-answer.ts:61` answers `plot-impl-status.sh` for `/plot-deliver`. `deliverability.ts:167` answers the deliver controller. `merged-desk.ts:33-34` sets desk state in `drop.ts` and `registry.ts`. A subject row in `rows` reaches all three through `isTerminalRow` (`merged-row.ts:17-18`), and `docs/domain/merge-subject.md:53-62` forbids a subject in a destructive decision.
- The three July plans in Motivation left no subject, so subject rows would not answer them.

With no subject rows, the daily `whole` fold (`rules/pr-index.ts:146-154`, `PR_FULL_READ_MS` at `pr-refresh.ts:331`) has no row of this plan to erase. The earlier claim "a merged row is written once and never re-asked" is withdrawn: a `whole` fold re-lists every row once per 24 hours, and that fold is the one answer that sees a deleted PR (`rules/pr-index.ts:149-151`).

If the operator wants subject rows in the store regardless, the mechanism is a v6 store with a separate `subjects` array beside `rows`, re-derived by `pr-refresh.ts` on every fold. `rows` keeps its contract, *"exactly what the host answered"*, and no existing reader sees a subject. Open Points hold this decision.

### Cost

- Per refresh: Bitbucket makes 3 list calls before and after this plan (`PR_REQUESTS_PER_REFRESH.bitbucket`, `pr-refresh.ts:249`). This plan saves 0 requests per refresh.
- Slice 1: until #2400 ships, a Bitbucket store with more than 50 PRs in one state never becomes whole. `prWindowFor` (`rules/pr-index.ts:394`) then asks a full read on every refresh: one page per state, 3 requests, the same count as a delta. Each call asks `--rich-open` instead of `--rich` (`pr-refresh.ts:1499`). The IndexMonitor retracts a finding for an absent PR only from a complete store (`index-findings.ts:179`), so those retractions stop on such a store.
- Slice 2: 0 requests. The walk costs 0.02 s at 2340 merges.
- Slice 3: today one `/plot-deliver` run with an unresolved un-annotated branch makes 1 listing request. After the slice it makes 1 request per such branch. The helper runs once per operator command.
- The plan buys correct answers, not budget. HTTP 429 relief needs the addendum's watch list, which Scope leaves out.

### Scope

Each point of the #2385 addendum, and where it goes:

| Addendum point | In this plan | Reason |
|---|---|---|
| List and single-PR GET throttled separately | no | The addendum measured it. This plan makes no host call to re-measure it. It motivates the watch list below. |
| One-time paged seed | no | #2400 owns paging of `bb_state_listing`. It waits on agent-skills#98. |
| Terminal rows written once, never re-asked | no | A `whole` fold is the only answer that sees a deleted PR (`rules/pr-index.ts:149-151`). Subject rows stay out of the index (above). |
| Open PRs as a watch list over single-PR GET | no | It changes `PR_REQUESTS_PER_REFRESH` (`pr-refresh.ts:205-250`) and so the refresh cadence. That is a cadence decision, and it stays on #2385 for a later plan. |
| One delta page after a fetch brings a new ref | no | `refreshPrs` never fetches. The fetch trigger is #2386 proposal 3, which #2386 leaves unscheduled. |
| Pairing with #2386's single reader | not needed | #2386's slice was deferred on 2026-10-25: PR #2436 closed unmerged, and `one-pr-index-writer.test.ts` refuses a board-side write to the index. This plan adds no index writer and no host reader beside `pr-refresh.ts`. |
| Local `plot-approve` lookup | no | An `OPEN` row is not terminal, and *A Decision Reads The Index* reads only terminal answers. #2407 (Delivered 2026-10-23) fixed the refusal text. |
| Declined PRs as terminal | no | `CLOSED` stays re-asked (`merged-row.ts:4-9`). Whether a declined Bitbucket PR can reopen is unmeasured, and this plan writes no row that depends on it. |

The branch-with-ref arm (`branch-state.ts:310-325`) is also out of scope. On ewz-kus-portal, 9 of 31 origin refs are behind `origin/develop`, and 6 of those 9 are the second parent of a merge. None of them is a July plan's slice branch.

### Open Questions

- [x] **One index or two?** — *answered round 1: neither.* The plan adds no file and no row. `pr-refresh.ts` stays the one writer of the one store.
- [x] **Subject or host for "did this land"?** — *answered round 1: the host.* No subject reaches a destructive decision, and *One Answer To "Did This Land"* stays as it is. The wave gate keeps its subject reading.
- [x] **What does the index store for a subject-derived row?** — *answered round 1: nothing.* See *Merge-Subject Rows*.
- [x] **Overlap with #2400** — *answered round 1:* #2400 makes the listing complete when `bb` supports `--all`. Slice 1 keeps the store honest before that, and for an older `bb`. Slice 3 stays needed after #2400, because `--limit 500` is below the 1770 merged PRs on ewz-kus-portal.
- [x] **Overlap with #2386** — *answered round 1:* #2386's slice is deferred, and this plan needs no single reader. See Scope.
- [x] **Squash or rebase merges** — *answered round 1:* a branch with no subject falls through to the host, and the index never answers `none` (`pr-index-lookup-answer.ts:61`). Measured: on Bitbucket a squash commit keeps the `Merged in` subject on a single-parent commit. Open Points hold the walk question.
- [x] **Reused branch names** — *answered round 1:* the age rule is keyed by plan (`merge-subject.md:43`) and does not carry over to a row keyed by PR number. With no subject rows, only the wave gate reads subjects, and it keeps the per-plan rule. Slice 3 has its own reused-name question in Open Points.

## Slices

### Honest Completeness

- `bug/a-short-bitbucket-listing-is-partial` — `pr_list_states` returns `PR_LIST_PARTIAL_RC` and names the state when `pr_list_report_truncation` calls a state possibly truncated, so `refreshPrs` folds the answer as `partial` and the store keeps `complete: false`. Every `pr-list` caller's exit-7 handling is surveyed first. Tests: `test/reconcile/host.test.mjs` — a Bitbucket stub that answers 50 rows and a `next` link for one state makes `pr-list --state all` exit 7, print every row, and name the state; a stub that answers fewer than 50 rows exits 0. `packages/domain/test/pr-index.test.ts` — a `partial` full read over a `complete: true` store keeps the held rows and writes `complete: false`. `packages/board/test/unit/fleet.test.ts` — a refresh whose host answer is `partial` on a full read writes `complete: false`. <!-- builds: a short Bitbucket listing folds as partial -->

### Whole Merge Walk

- `bug/the-merge-walk-reads-the-whole-log` — `MERGE_SCAN_LIMIT` (`plot-fleet-scan.sh:472`) and `MERGE_WALK_LIMIT` (`registryd-main.ts:599`) rise to 20 000, and the saturation report stays. The comment at `merge-subjects.ts:22-24` states the Bitbucket squash measurement beside the GitHub one. Tests: the saturation tests in `test/reconcile/fleet.test.mjs` pass unchanged through the `PLOT_MERGE_SCAN_LIMIT` seam; a test asserts that the scan's default and `MERGE_WALK_LIMIT` are equal. <!-- builds: a 20 000-merge walk for the wave gate -->

### Delivery Lookup By Name

- `bug/impl-status-asks-merged-prs-by-branch` — `plot-impl-status.sh` asks `pr-list --state merged --branch <branch>` once per un-annotated branch that the index could not answer, instead of one `--limit 500` listing; the shipped shell line count does not grow (`scripts/check-shell-lines.sh`). Tests: `test/reconcile/impl-status-index.test.mjs` — with a Bitbucket stub whose merged listing holds 50 newer rows, a branch merged outside them resolves through the by-name query; a branch with no merged PR stays unresolved, and delivery refuses it; a fully merged plan that the index answers still makes zero host calls. <!-- builds: a by-name merged lookup for plot-impl-status -->

## Notes

- Source: issue #2385, https://github.com/plot-pm/plot/issues/2385. Related: #333 (truncated merged list), #1139 (merged branch from its merge commit), #2400, #2386, #2484, #2407.
- Measurements, 2026-10-26, read-only. ewz-kus-portal `origin/develop`: 2340 merges in 0.02 s (3 runs); 1770 `Merged in` subjects for PR #1795 to #3719; 87 branch names with more than one subject; 0 single-parent commits with a `Merged in` subject. All commits: 16 884, walked in 0.10–0.12 s. Across about 70 local Bitbucket clones: 7 single-parent commits with a `Merged in` subject, in 5 repositories. This repository: 677 merges in 0.014 s (cost juror, 2026-10-23).
- 2026-10-26, panel round 1 revision (`.plot/panels/2026-10-23-read-merged-prs-from-the-merge/panel.md`, checked against `origin/main` `3975b9768`): no subject row enters the PR index, so no subject reaches delivery and the `whole` fold erases nothing of this plan (agreed 1 and 2). Each addendum point has a row in Scope (agreed 3). The short Bitbucket listing is slice 1, because #2484 did not change `bb_state_listing` (three-juror finding). Full walk with no cursor (disagreement 1). The board sentence left the Changelog: the three July plans' PRs left no subject, and their *state unknown* comes from HTTP 429 (disagreement 2). Cost names 0 requests saved per refresh (disagreement 3). The `plot-approve` lookup and declined PRs are out of scope (disagreements 4 and 5). The 2000 cap rises to 20 000 in slice 2 (blind spot 1). The `complete: true` path was re-read on current code (blind spot 2). The squash subject was measured, and the walk question is an open point (blind spot 3).

## Open Points

- [ ] [Scope] Does the operator accept the reshaped scope: no subject rows in the PR index, three bug slices, and the addendum out of scope? The alternative is the v6 `subjects` array in *Merge-Subject Rows*. — *decides: the operator, at approval*
- [ ] [Technical] Can every `pr-list` caller take exit 7 for a short listing? Slice 1 surveys `plot-fleet-scan.sh`, `plot-impl-status.sh`, `plot-reconcile-scan.sh`, `plot-pr-merged.sh` and the host adapter first. If a caller cannot take it, the fallback is a stderr marker that the adapter reads. — *decides: the survey in slice 1*
- [ ] [Domain] Which merged PR does slice 3 take for a reused branch name? A by-name query returns every merged PR of the name, and ewz-kus-portal holds 87 reused names. Today `merged_pr_for_branch` takes the first listed row (`plot-impl-status.sh:274-277`), and `mergedRowByHead` takes the lowest number (`merged-row.ts:30-33`), so both can pick an earlier attempt. — *decides: whether a Bitbucket row carries `mergedAt` or a merge commit, so the per-plan age rule (`merge-subject.md:43`) applies; slice 3 measures it read-only on ewz-kus-portal*
- [ ] [Technical] Does the wave gate drop `--merges` to read squash subjects? Across about 70 local Bitbucket clones, 7 single-parent commits carry a `Merged in` subject, and ewz-kus-portal holds 0. Walking every commit costs 0.10–0.12 s against 0.02 s on ewz-kus-portal. The default keeps `--merges`. — *decides: the operator, from these numbers*
- [x] [Domain] Does a merge-log row settle `pr: MERGED` for delivery? — *answered round 1: no.* No subject row enters the index. See *Merge-Subject Rows*.
- [x] [Technical] What does a v6 row hold? — *answered round 1:* there is no v6. `PR_INDEX_VERSION` stays 5.
- [x] [Technical] How do merge-log rows survive a `whole` fold? — *answered round 1:* there are none to survive. The "written once" claim is withdrawn.
- [x] [Technical] A truncated Bitbucket listing records `complete: true`. — *answered round 1:* slice 1. #2484 did not change `bb_state_listing`, and #2400 is blocked.
- [x] [Technical] Incremental cursor or full walk? — *answered round 1: full walk*, 0.02 s for 2340 merges, with no new field.
- [x] [Deliverable] Which reader shows the Changelog's board change? — *answered round 1: none.* The board sentence left the Changelog; see Motivation.
- [x] [Deliverable] Split the one slice? — *answered round 1:* three slices, one deliverable each. The subject-to-number rule is not built.
- [x] [Domain] How does a branch-only lookup resolve a reused name? — *answered round 1:* no subject row exists to look up. Slice 3's own case is the open point above.
- [x] [Scope] Adopt, defer or exclude each #2385 addendum point. — *answered round 1:* see the Scope table.
- [x] [Domain] Is a declined PR terminal? — *answered round 1: out of scope.* `CLOSED` stays re-asked.
- [x] [Domain] Does the addendum's local `plot-approve` lookup stay? — *answered round 1: no.* It reads a non-terminal row.
- [x] [Sibling] Who owns the fetch trigger and where does the store live? — *answered round 1:* this plan adds no fetch trigger and no store. #2386's slice is deferred.
- [x] [Cost] Does the saving justify the slice? — *answered round 1:* 0 requests saved per refresh. The plan claims correct answers only; see Cost.
- [x] [Unmeasured] Does a Bitbucket squash merge leave a `Merged in … (pull request #N)` subject? — *answered round 1: yes*, on a single-parent commit (7 commits in about 70 clones). The walk question is the open point above.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {"q": "Panel round 1: estate, contradiction, deliverable and cost lenses", "a": "unanimous amend; moderation at .plot/panels/2026-10-23-read-merged-prs-from-the-merge/panel.md; revision 2026-10-26 answered 14 points and left 4 open", "category": "panel"}
  ],
  "deferredItems": [
    {"q": "Accept the reshaped scope, or restore subject rows as a v6 subjects array?", "category": "scope", "context": "Open Points"},
    {"q": "Can every pr-list caller take exit 7 for a short listing?", "category": "technical", "context": "Open Points"},
    {"q": "Which merged PR does slice 3 take for a reused branch name?", "category": "domain", "context": "Open Points"},
    {"q": "Does the wave gate drop --merges to read squash subjects?", "category": "technical", "context": "Open Points"}
  ],
  "categoriesCovered": {
    "technical": {"stack": false, "architecture": true, "implementation": true},
    "domain": true,
    "ux": {"happyPath": false, "edgeCases": false, "errors": false, "accessibility": false},
    "nonFunctional": {"security": false, "performance": true, "scalability": true},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
