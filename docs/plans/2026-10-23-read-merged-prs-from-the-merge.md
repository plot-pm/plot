# Bitbucket PR index: read merged PRs from the merge log

> On Bitbucket the host lists one page of 50 merged PRs, so an older merged PR reads as "no PR". The default branch's merge log holds every merged PR, and git answers it with no API call.

## Status

- **State:** Draft
- **Type:** feature
- **Issue:** #2385
- **Review:** pr
- **Impl:** own branches

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
