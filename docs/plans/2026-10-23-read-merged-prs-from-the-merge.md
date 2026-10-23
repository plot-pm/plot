# Bitbucket PR index: read merged PRs from the merge log

> On Bitbucket the host lists one page of 50 merged PRs, so an older merged PR reads as "no PR". The default branch's merge log holds every merged PR, and git answers it with no API call.

## Status

- **State:** Draft
- **Type:** feature
- **Issue:** #2385
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- On Bitbucket, Plot reads merged PRs from the default branch's merge log and records them in the PR index. An old merged PR stops reading as "no PR", and the board no longer shows a delivered plan as *state unknown* because a listing page ended.

<!-- Board impact: the board reads the PR index it already reads; rows gain a source. No plan format, template or docs/plans layout change is intended. Confirm in Design. -->

## Motivation

Measured 2026-10-23 on ewz-kus-portal (Plot 2.28.0, bb 1.11.2): `plot-host.sh pr-list --state merged --limit 1000` returns 50 rows and prints *"possibly truncated (50 rows, requested limit 1000 unprovable)"*. Three delivered July plans show under *Not started* with *state unknown — the host's answer is incomplete*, while the board keeps hitting HTTP 429 (#333).

Each refresh also spends requests on PRs whose state cannot change again. A merged PR is terminal.

A Bitbucket merge commit on the default branch carries the subject `Merged in <branch> (pull request #N)`. `git log origin/<default> --merges` yields the branch, the PR number, the merge commit and the date for the whole history, with zero API calls.

## Design

### Approach

1. **Read merged PRs from the merge log.** After each `git fetch`, parse the merge subjects with the existing merge-subject rule (`packages/domain/src/rules/merge-subject.ts`, form `Merged in <branch> (pull request #<number>)` in `adapters/host/merge-subjects.ts`). Read only `<last indexed>..origin/<default>` after the first pass.
2. **Record the result in the PR index.** The store (`PR_INDEX_VERSION` 5, `entities/pr-index.ts`) already holds merged rows, a `complete` flag and a watermark, with `pr-refresh.ts` as its one writer. A merged row is terminal, so it is written once and never re-asked.
3. **Ask the host only for what can change:** open PRs, declined PRs, and merges with no merge message (squash and rebase).

### Open Questions

- [ ] **One index or two?** The issue proposes a new append-only file `.plot/state/pr-index`. An index with a single writer already exists (`foldPrIndex`, `pr-refresh.ts`). Does the merge log feed that store, or does it need a second file? A second writer breaks the one-writer rule in CLAUDE.md.
- [ ] **Subject or host for "did this land"?** CLAUDE.md, *One Answer To "Did This Land"*, reserves destructive decisions (reap, release refs, delivery) for the host's `mergedAt`. A merge subject proves a merge only for a non-destructive wave gate today. Does a merge-log row feed the same wave gate only, or may it settle `pr: MERGED` in the index for every reader? The answer decides whether this plan changes that section.
- [ ] **What does the index store for a subject-derived row?** A merge commit gives branch, number, commit and date. It gives no title, checks or `mergedAt` from the host. Does the row carry a source marker, and which readers accept it?
- [ ] **Overlap with #2400** (`plot-host-bitbucket-pr-list-reads`, Approved): `bb pr list --all` makes the listing complete, but costs one request per page. Does the merge log still pay for itself once #2400 ships, or does it only remove the per-refresh cost?
- [ ] **Overlap with #2386** (`one-pr-reader-per-machine-and`, Approved): one reader per machine and account. Does the merge-log reader run inside that reader?
- [ ] **A repo with squash or rebase merges** leaves no merge message. Confirm the fallback to the host keeps the *state unknown* report for such a PR, and never reports `none`.
- [ ] **Reused branch names.** A name merged, deleted and reused makes an old subject describe earlier work. The merge-subject age rule (`docs/domain/merge-subject.md`) covers it for the wave gate. Confirm it carries over.

## Slices

### Merge-log reader

- `feature/read-merged-prs-from-the-merge` — derive merged PR rows from `git log origin/<default> --merges` on Bitbucket, fold them into the PR index incrementally, and ask the host only for open, declined and message-less merges. <!-- builds: a merge-log reader that yields merged PR rows for the PR index -->

## Notes

- Source: issue #2385, https://github.com/plot-pm/plot/issues/2385. Related: #333 (truncated merged list), #1139 (merged branch from its merge commit), #2400, #2386.

## Open Points

- [ ] [Domain] Does a merge-log row settle `pr: MERGED` for delivery? Today `plot-impl-status.sh:169-175` accepts any MERGED non-draft store row (`rules/merged-row.ts:17`), and `/plot-deliver` runs it. Either the row carries a source marker that `isTerminalRow`, `mergedRowByHead`, `plot-impl-status.sh` and the IndexMonitor refuse, or this plan amends *One Answer To "Did This Land"* and the boundary table in `docs/domain/merge-subject.md`. — *panel round 1, all four lenses: decision for the operator*
- [ ] [Technical] What does a v6 row hold? `PrIndexRowSchema` is `.strict()` and requires `draft`, `checks`, `review` and `url` (`entities/pr-index.ts:30-90`), and git answers none of them. A source marker means `PR_INDEX_VERSION` 5 → 6. A git date written as `mergedAt` would fire the IndexMonitor's `pr merged` finding (`index-findings.ts:58-63`). — *panel round 1, contradiction and deliverable lenses*
- [ ] [Technical] How do merge-log rows survive a `whole` fold? `foldPrIndex` starts empty on `whole` (`rules/pr-index.ts:147-154`), so every daily full read (`PR_FULL_READ_MS`) and every cold start drops them. Decide: re-derive the rows on every fold, or keep rows by source. — *panel round 1, all four lenses*
- [ ] [Technical] A truncated Bitbucket listing exits 0, folds as `whole` and records `complete: true` (`plot-host.sh:3049`, `scripts-shell.ts:99`, `pr-refresh.ts:1701`; read, not run against a v5 store). Fix it in this plan, or hand it to #2400? — *panel round 1, estate, contradiction and deliverable lenses*
- [ ] [Technical] Use an incremental `<last indexed>..` cursor or a full walk on each pass? The full walk costs 14 ms for 677 merges here and 20 ms for 2340 merges on ewz-kus-portal. A cursor needs a new field, because `watermark` is the host's `updatedAt`. The scan's walk caps at 2000 (`plot-fleet-scan.sh:472`) and ewz-kus-portal already exceeds that, so the reader must not reuse the capped walk. — *panel round 1, cost lens against contradiction and deliverable*
- [ ] [Deliverable] Which reader shows the Changelog's board change? The *state unknown* note (`fleet.ts:4292`) comes from `plot-fleet-scan.sh` → `branch-state.ts:310-325`, which never reads the PR index. Decide: add a slice that joins index MERGED rows by PR number into branch state for a branch with a ref (the reused-name guard at `branch-state.ts:227-237` forbids a join by name), or drop the board sentence from the Changelog. Which arm fired for the three July plans on ewz-kus-portal is unmeasured. — *panel round 1, deliverable lens*
- [ ] [Deliverable] Split the one slice? The deliverable lens names four deliverables: subject → row with the v6 schema; fold survival and a correct `complete`; the branch-state reader; host-ask reduction after #2386. The merge-log walk itself exists (`refs-git.ts:744`, `ports/refs.ts:659`). The rule that turns a subject into a PR number is new: `mergedBySubject` returns `{sha, branch}` only (`rules/merge-subject.ts:88,160`). — *panel round 1, deliverable and estate lenses*
- [ ] [Domain] How does a branch-only lookup resolve a reused name? The age rule is keyed by plan (`merge-subject.md:43`) and cannot carry over to a row keyed by PR number. `mergedRowByHead` takes the lowest PR number (`merged-row.ts:21-25`), and ewz-kus-portal holds 87 reused names. #2400's full paging brings the same hazard. — *panel round 1, contradiction, deliverable and estate lenses; replaces Open Question 7's "confirm it carries over"*
- [ ] [Scope] Adopt, defer or exclude each #2385 addendum point. Not covered today: the measurement that list and single-PR GET are throttled separately; the one-time paged seed (needs #2400); the open-PR watch list over single-PR GET (`pr-state <n>` → `bb pr view` exists, `plot-host.sh:3822`); one delta page, asked only after a fetch brings a new ref (today `bb_window_listing` asks `updated_on>=` for every state on every refresh, `plot-host.sh:1212`); pairing with #2386. — *panel round 1, all four lenses*
- [ ] [Domain] Is a declined PR terminal? The addendum says yes. `merged-row.ts:6-9` re-asks CLOSED, and this plan agrees with the code. Whether a declined Bitbucket PR can reopen is unmeasured. — *panel round 1, contradiction and deliverable lenses*
- [ ] [Domain] Does the addendum's local `plot-approve` lookup stay? An open PR row is not terminal, so the lookup conflicts with "only terminal answers are read from the index". #2407 fixes only the refusal text. — *panel round 1, contradiction lens*
- [ ] [Sibling] Who owns the fetch trigger and where does the store live? #2386 approach 3 adds the same refresh after a `git fetch`, and its open question on the cache location is unanswered. Settle both with #2386 before this slice starts. — *panel round 1, contradiction lens*
- [ ] [Cost] Does the saving justify the slice? Bitbucket still makes 3 list calls per refresh (`pr-refresh.ts:249`), because a squash merge leaves no subject. The saving is on the daily full read, about 35 merged pages once #2400's `--all` ships. Measure after #2400, or state the number now. — *panel round 1, cost and estate lenses*
- [ ] [Unmeasured] Does a Bitbucket squash merge leave a `Merged in … (pull request #N)` subject? ewz-kus-portal holds 1770 such merge subjects against PR numbers up to 3719, and 8 non-merge commits carry `pull request #`. — *panel round 1, moderator*

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {"q": "Panel round 1: estate, contradiction, deliverable and cost lenses", "a": "unanimous amend; moderation at .plot/panels/2026-10-23-read-merged-prs-from-the-merge/panel.md", "category": "panel"}
  ],
  "deferredItems": [
    {"q": "Does a merge-log row settle pr: MERGED for delivery?", "category": "domain", "context": "Open Points"},
    {"q": "What does a v6 row hold?", "category": "technical", "context": "Open Points"},
    {"q": "How do merge-log rows survive a whole fold?", "category": "technical", "context": "Open Points"},
    {"q": "Truncated Bitbucket listing records complete: true", "category": "technical", "context": "Open Points"},
    {"q": "Incremental cursor or full walk?", "category": "technical", "context": "Open Points"},
    {"q": "Which reader shows the board change?", "category": "deliverable", "context": "Open Points"},
    {"q": "Split the one slice?", "category": "deliverable", "context": "Open Points"},
    {"q": "Reused branch names in a branch-only lookup", "category": "domain", "context": "Open Points"},
    {"q": "Adopt, defer or exclude each addendum point", "category": "scope", "context": "Open Points"},
    {"q": "Is a declined PR terminal?", "category": "domain", "context": "Open Points"},
    {"q": "Local plot-approve lookup", "category": "domain", "context": "Open Points"},
    {"q": "Fetch trigger owner and store location with #2386", "category": "sibling", "context": "Open Points"},
    {"q": "Does the saving justify the slice?", "category": "nonFunctional", "context": "Open Points"},
    {"q": "Bitbucket squash merge subject", "category": "technical", "context": "Open Points"}
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
