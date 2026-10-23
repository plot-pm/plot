# Panel: read-merged-prs-from-the-merge (round 1)

Subject: `docs/plans/2026-10-23-read-merged-prs-from-the-merge.md` (Draft, #2385, plan PR #2419).
Caller: `/challenge-the-plan` Phase 3P. Commitment: `Position: proceed,amend,reject`.
Siblings: 3 read, 0 unread (no active sprint; unfinished plans on `origin/main`: #2400 `plot-host-bitbucket-pr-list-reads`, #2386 `one-pr-reader-per-machine-and`; plus #2407 `plot-approve-reports-no-pr-found`, read from its plan PR and since merged).

## Gate

| Juror | `plot-panel.mjs check` | Position |
|---|---|---|
| estate | exit 0 | amend |
| contradiction | exit 0 | amend |
| deliverable | exit 0 | amend |
| cost | exit 0 | amend |

`plot-panel.mjs reconcile`: `unanimous amend estate,contradiction,deliverable,cost`. No juror was sent back.

## What each juror looked at

- **estate** — read only. No command beyond grep and file reads.
- **contradiction** — read, and ran read-only `git log` and `jq` against ewz-kus-portal's merge log and PR store. It also ran one `git fetch -q` in the main checkout (remote-tracking refs only).
- **deliverable** — read only.
- **cost** — read, and ran the merge-log walk on this repo (677 merges, 14 ms, 513 `Merge pull request` subjects against PR numbers up to 2417).

## Agreement

All four jurors find the same three defects, each from a different reading:

1. **A subject-derived MERGED row reaches delivery.** `plot-impl-status.sh:169-175` accepts any MERGED non-draft store row (`rules/merged-row.ts:17`, `pr-index-lookup-answer.ts:60-70`), and `/plot-deliver` runs it. That breaks *One Answer To "Did This Land"* and the boundary table in `docs/domain/merge-subject.md`. A source marker and `PR_INDEX_VERSION` 6 are needed, or the section is amended.
2. **The daily `whole` fold erases the rows.** `foldPrIndex` starts empty on `whole` (`rules/pr-index.ts:147-154`). "Written once, never re-asked" is false until the plan names a fold change.
3. **The #2385 addendum is mostly uncovered.** Merged-only terminal rows are covered. The single-PR watch list, the paged seed, the fetch-gated delta page and the #2386 pairing are not.

Three jurors (estate, contradiction, deliverable) also report that a truncated Bitbucket listing exits 0, folds as `whole` and records `complete: true`.

## Disagreements

1. **Cursor or full walk.** Contradiction and deliverable ask for a merge-log cursor field in the v6 schema. Cost says the cursor does not pay for its state: the full walk costs 14 ms here. Moderator measurement on ewz-kus-portal: 2340 merges, 20 ms. The cost juror's reading holds on the largest measured estate.
2. **Whether the slice reaches the board at all.** Only deliverable traced the Changelog's board sentence to its source. The *state unknown* note comes from `plot-fleet-scan.sh` → `branch-state.ts:310-325`, and that path never reads the PR index. The other three jurors assume that a correct index fixes the board. If deliverable is right, the plan as written changes `/plot-deliver` and `plot-reconcile` and not the board.
3. **Where the saving is.** Cost: no per-refresh request is saved (3 list calls per refresh stay, `pr-refresh.ts:249`). Only the daily full read shrinks. Estate: measure after #2400 ships before building. Contradiction: state the value for each order of #2400 and this plan. Deliverable: split the work into four or five slices. These describe the same gap — the plan names no number for its saving — and propose different responses.
4. **The addendum's local `plot-approve` lookup.** Deliverable lists it as missing coverage. Contradiction says it conflicts with "only terminal answers are read from the index", because an open PR row is not terminal.
5. **Declined PRs.** The addendum calls declined terminal. Contradiction and deliverable point out that `merged-row.ts:6-9` re-asks CLOSED, and the plan agrees with the code. Nobody measured whether a declined Bitbucket PR can reopen.

## Shared blind spots

1. **The scan's merge walk is already saturated on the estate that motivated the plan.** `plot-fleet-scan.sh:472` caps the walk at 2000 merges. ewz-kus-portal has 2340 merges on `origin/develop` (moderator, ran). Estate and deliverable proposed reusing this walk. A reader built on it recreates the 50-row truncation at 2000.
2. **The `complete: true` evidence comes from a stale store.** The ewz-kus-portal store that contradiction read is `v: 2` from 2026-10-02 (111 rows: 50 MERGED, 50 CLOSED, 11 OPEN, `wholeAt: null`). The current code accepts only `v: 5`. Every reader therefore falls through to the host there, and the claim that current code writes `complete: true` on a truncated read rests on reading `pr-refresh.ts:1701` and `scripts-shell.ts:99` only.
3. **The squash subject on Bitbucket is unmeasured.** ewz-kus-portal holds 1770 `Merged in … (pull request #N)` merge subjects against PR numbers up to 3719, and 8 non-merge commits carry `pull request #`. No juror separated declined PRs, merges into other targets and squash merges in that gap.

## Outcome

The panel is unanimous on `amend`. Nothing is approved. The open points go to the plan's `## Open Points`.
