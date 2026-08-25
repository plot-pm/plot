# Bitbucket: the PR-list join is silently partial past 50 PRs per state

> Detect when Bitbucket's fixed page cap truncates the PR list and fall back to per-branch lookups for branches the join cannot answer.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:** #333
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- `plot-fleet-scan.sh` detects a truncated Bitbucket PR list and falls back to per-branch lookups for unresolved branches, so a branch whose PR is beyond page 50 no longer reads as "no PR"

## Motivation

`plot-fleet-scan.sh`'s `prefill_pr_states` asks `plot-host.sh pr-list --state all --limit 1000` once and joins locally. On GitHub the limit is honoured. On Bitbucket the limit is **dropped**: `bb pr list` has no `--limit` flag, so the adapter drops it (with a stderr warning) and returns the fixed page size of 50 PRs per state.

Past 50 PRs in any state, the join sees a partial set. A branch whose PR is not on the page joins to nothing and reads as **no PR** — the same fabricated verdict the scan refuses everywhere else:

> Joining against the newest 30 would silently lose 191 PRs — every older merged branch reading as "no PR", which is the fabricated verdict this scan refuses everywhere else.

The failure is quiet: a stderr line the board never surfaces, then wrong rows.

This is **not** the N+1 issue fixed in #228 (v2.7.0). That was the **shape** — N branches × 3 states. This is the **completeness** of the one list the fix now depends on. The join made the scan correct-and-fast on Bitbucket while making it newly sensitive to a page cap that did not matter when every branch was asked about individually.

Severity is low today (this repo is GitHub; the measured Bitbucket repo had 9 branches) and rises with PR count.

## Design

### Approach

The middle path from the issue: detect a full page (exactly 50 results in any state) and mark the list as **incomplete**, so the scan can fall back to per-branch lookups for the branches it could not answer. Absent is not false.

**Option A — Page until exhausted:** `bb pr list` exposes no cursor; paging would require guessing at offsets or reverse-engineering undocumented behaviour. Rejected.

**Option B — Detect truncation, fall back:** When `plot-host.sh pr-list` returns exactly 50 results in any state, it signals "list may be incomplete". The scan joins what it has, then asks the host directly for any branch that joined to nothing. This preserves the N+1 fix for the common case (≤50 PRs per state) and degrades gracefully past that threshold.

**Option C — Surface truncation only:** Make the stderr warning visible on the board. Does not fix the wrong rows. Rejected as sole solution; useful as supplement.

Choosing **Option B** with a visible indicator (Option C as supplement) when truncation is detected.

**Implementation:**

1. **`plot-host.sh pr-list`** returns a structured response with a `truncated` field per state when the result count equals the known page cap (50 for `bb` 1.0.0)
2. **`plot-fleet-scan.sh`** checks the `truncated` flag; for any state marked truncated, branches that joined to nothing are looked up individually via `plot-host.sh pr-state`
3. The board's pulse output includes a `truncated_states` field so operators know the scan fell back

### Open Questions

- [ ] Does `bb pr list` have any pagination mechanism we could use instead of falling back to per-branch?
- [ ] Should the fallback apply to all unresolved branches or only to branches where the PR would plausibly exist (e.g., branches with commits)?

## Branches

### Implementation

- `feature/the-pr-list-join-is-silently` — Detect Bitbucket page truncation in `plot-host.sh pr-list`, signal incompleteness, and fall back to per-branch lookups in `plot-fleet-scan.sh` for branches the join cannot answer

## Notes

- Found 2026-08-23 while confirming #228 on plot 2.7.0
- Related: #228 (the N+1 fix this depends on)
