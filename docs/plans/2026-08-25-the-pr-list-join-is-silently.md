# Bitbucket: the PR-list join is silently partial past 50 PRs per state

> Detect when Bitbucket's fixed page cap truncates the PR list and fall back to per-branch lookups for branches the join cannot answer.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** the-board-serves-an-enterprise-stack
- **Issue:** #333
- **Story:** the-board-is-blank-where-it-matters
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 2

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

- [x] Does `bb pr list` have any pagination mechanism we could use instead of falling back to per-branch? **No.** Measured 2026-08-26 against `bb` 1.0.0: `bb pr list` exposes only `--state`, `--json`, `--repository` and `--web`. No cursor, no offset, no limit. Option A is closed.
- [x] Should the fallback apply to all unresolved branches or only plausible ones?
      **Only branches with commits.** Answered 2026-08-26 from the code rather
      than by preference: `plot-fleet-scan.sh` already separates `wip` (real
      unlanded commits) from `claimed` (an empty claim marker beyond main), and
      that derivation is free — no host call. A `claimed` branch that joined to
      nothing almost certainly has no PR, so asking about it spends a round trip
      to learn nothing. See *Bounding the fallback* below.

### Bounding the fallback with a fact the scan already has

The fallback asks the host per branch, which is the N+1 the join was built to
remove — so it must be bounded by something, and the cheapest bound is one that
costs nothing to compute.

`plot-fleet-scan.sh` already derives `wip` from `claimed`: the first means real
unlanded commits, the second an empty claim ref. Only a `wip` branch that joined
to nothing gets a per-branch lookup. A `claimed` one is skipped, because a
branch with no commits has no PR to find.

**This bounds the cost by the work, not by a number.** A cap of *N lookups* would
be arbitrary and would silently drop the N+1st branch — the same quiet
incompleteness this plan exists to fix, one level in.

### Truncation is detected, not hardcoded

The obvious detector is `count == 50`, `bb` 1.0.0's page size. It fails in the
direction that matters: if a future `bb` returns 100, a 100-PR state reports
complete when it is truncated — **the original bug, restored silently**.

So the comparison is against the **requested limit**, not a constant: a page that
comes back as full as it could be is possibly truncated, whatever the number. It
misfires benignly when a state holds exactly the limit (says truncated when
complete, costing a few lookups) and cannot misfire in the dangerous direction.

## Branches

### Implementation

- `feature/the-pr-list-join-is-silently` — Detect Bitbucket page truncation in `plot-host.sh pr-list`, signal incompleteness, and fall back to per-branch lookups in `plot-fleet-scan.sh` for branches the join cannot answer

## Notes

- Found 2026-08-23 while confirming #228 on plot 2.7.0
- Related: #228 (the N+1 fix this depends on)

### Brought onto main 2026-08-26

Written 2026-08-25 on `idea/the-pr-list-join-is-silently` and left as **PR #408**,
never approved. The sprint `the-board-serves-an-enterprise-stack` names it a
Should Have, and a sprint cannot name a plan its own repo cannot resolve — the
reconcile scan reports that as drift, correctly.

So the file is brought over unchanged in substance, with `Sprint:` and `Story:`
filled and `Review:` moved from `pr` to `in-session`: the PR route was the
original intent, but the content is now reviewed in the sprint rather than in a
PR that has sat unmerged for a day. **#408 should be closed as superseded** once
this lands, not merged — merging it would add a second copy of this file.

Its two Open Questions are unchanged and still open.

### Interrogated 2026-08-26

One round, and both of the original open questions moved.

The fallback's scope was answered from the code: the scan already computes
`wip` vs `claimed`, so plausibility is free and the fallback is bounded by the
work rather than by an arbitrary cap.

The truncation detector was changed from `count == 50` to a comparison against
the requested limit. The constant fails silently in the dangerous direction — a
future `bb` page size would make a truncated list report complete, which is this
plan's own defect restored.

Pagination stays open, and the design is deliberately correct either way: if
`bb` gains a cursor, the fallback becomes unnecessary rather than wrong.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 2,
  "questionHistory": [
    {
      "q": "Fallback for all unresolved branches or only plausible ones?",
      "a": "Only wip branches \u2014 the scan already distinguishes them from claimed, free",
      "category": "technical"
    },
    {
      "q": "Is count==50 a safe truncation detector?",
      "a": "No \u2014 compare against the requested limit; the constant fails silently in the dangerous direction",
      "category": "technical"
    }
  ],
  "deferredItems": [
    {
      "q": "Does bb pr list expose pagination?",
      "category": "technical",
      "context": "Design"
    }
  ],
  "categoriesCovered": {
    "technical": {
      "stack": false,
      "architecture": true,
      "implementation": true
    },
    "domain": false,
    "ux": {
      "happyPath": false,
      "edgeCases": false,
      "errors": false,
      "accessibility": false
    },
    "nonFunctional": {
      "security": false,
      "performance": true,
      "scalability": false
    },
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->

### Interrogated again 2026-08-26 — the cap is measured now, and it is worse

Round two set out to verify the page cap the whole design keys off, because the
plan and `plot-host.sh:494` both attribute *50* to **bb 1.0.0** while the `bb`
first on this machine's PATH is **0.6.0**.

**The cap is real. Measured against `quatico/quaweb-website` with `bb` 1.0.0:**

```
merged PRs returned : 50          ids 836 → 787
open                : 4
newest PR in repo   : #836
```

Fifty exactly, and the repo's PR numbering reaches 836 — so roughly **780 older
merged PRs are invisible to the join**. Every branch older than #787 joins to
nothing and reads as *no PR*.

**That overturns this plan's own severity estimate.** It said *"Severity is low
today (this repo is GitHub; the measured Bitbucket repo had 9 branches) and
rises with PR count."* On a real client repo the loss is ~94% of merged PRs,
not a tail case. The threshold was crossed long ago and nobody saw it, because
the failure is a quiet empty join.

**Pagination is closed as an option:** `bb pr list` has no cursor, offset or
limit flag in 1.0.0 — only `--state`, `--json`, `--repository`, `--web`. Option
A was rejected on a guess and is now rejected on a measurement.

### It uncovered a separate, larger defect

Measuring required running `bb` by hand, which is how the two-binary shadowing
surfaced: homebrew's **0.6.0 has no `--json` flag at all** and sits ahead of
1.0.0 on PATH, so `plot-host.sh`'s `bb pr list --json` returns *nothing* rather
than a truncated page.

That is written up separately as [[the-adapter-checks-the-cli-it-got]] — it is a
different bug (no answer at all, versus a partial one), and this plan's
truncation detection is meaningless until the adapter is actually reaching a
capable binary. **That plan should land first.**
