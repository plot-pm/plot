# A capped page says what it hid

> `bb pr list` returns a bare array with no cursor, so past 50 PRs in a state the join sees a partial set and a branch whose PR is off the page reads as having none.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #333
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A Bitbucket PR list that hit the page cap reports how many rows it could not see, so a caller can tell a short list from a complete one.

<!-- Board impact: the scan and the board learn a count they do not have today.
     No plan format, no template, no layout. -->

## Design

Reported as #333: `plot-fleet-scan.sh` asks `pr-list --state all --limit 1000`
once and joins locally. On GitHub the limit is honoured. On Bitbucket it is
**dropped** — `bb pr list` has no `--limit` flag — and each state returns at
most one page.

**This repository is already over the cap.** Measured 2026-09-20 on
`quaweb-website`:

```
open: 3 rows   merged: 50 rows   declined: 13 rows
```

`merged: 50` is exactly the page size. There are more merged PRs than that, and
the join cannot see them: a branch whose PR is off the page joins to nothing and
reads as **no PR** — the fabricated verdict the scan refuses everywhere else.

### The obvious fix is not available

Paging needs a cursor, and `bb` discards it. Measured:

```
bb pr list --state merged --json  →  a bare array; no `next`, no `size`, no envelope
```

Bitbucket's REST API does paginate — `pullrequests?pagelen=100` returns
`{size, pagelen, next, values}` — and `bb api <path>` exists as an escape hatch.
**It is not usable here:**

```
$ bb api "repositories/<slug>/pullrequests?state=MERGED&pagelen=100"
error: HTTP 403 — Forbidden
```

The token has scope for `bb`'s own commands and not for arbitrary REST paths. So
a fix that pages through `bb api` would work on some installations and fail on
this one, which is the reporting repository.

### What is achievable is the honest count

The adapter **already knows** it may have hidden rows —
`pr_list_report_truncation` warns per state today:

> `plot-host: bitbucket pr-list state=merged possibly truncated (50 rows, requested limit 1000 unprovable)`

What it cannot say is **how many** it hid, because the bare array carries no
total. But `bb pr list` can be asked a second time for a **count** it can prove:
if a state returns exactly the page size, the list is short by an unknown amount,
and that is a different statement from *possibly truncated* — which fires for any
non-empty page and therefore says almost nothing.

**So the slice narrows the warning rather than widening the data**: a page under
the cap is provably complete and should stop warning; a page at the cap is
provably incomplete and should say so. Today both produce the same sentence,
which is why the board's banner carries a truncation warning for a three-row
list that is demonstrably whole.

### What this does NOT do

**It does not page.** The rows past the cap stay invisible until either `bb`
grows a paging flag or a token with REST scope is available. Naming that
honestly is the deliverable; inventing rows is not.

**It does not change the GitHub arm**, which honours `--limit` and already
distinguishes complete from capped by comparing the row count to the limit.

**It does not touch the partial classification.** A capped page is a **complete
answer to a narrowed question**, not a failed state, so it must not become
`PR_LIST_PARTIAL_RC` — that code means *some states did not answer*.

## Slices

### A full page is not a possible truncation (Branch: bug/a-full-page-is-not-a-possible-truncation)

- `bug/a-full-page-is-not-a-possible-truncation` — the truncation warning fires only where the page is provably capped, and names the cap

**Done when** a Bitbucket state returning **fewer** rows than the page size
produces **no** truncation warning, pinned by a test — today a three-row list
warns; a state returning **exactly** the page size warns and says it hit the
cap, pinned; the page size is read from the measured response rather than
hardcoded to 50, so a future `bb` page size does not silently restore the
defect — the existing detector already refuses to hardcode it and that reasoning
holds; the GitHub arm's behaviour is **byte-identical**, pinned; no exit code
changes, since a capped page is a complete answer to a narrowed question and
must never become `PR_LIST_PARTIAL_RC`; the scan's `#333` reference in the
warning text still points readers at the open limitation; and
`pnpm run test:contracts` passes.

## Notes

**#333 stays open after this slice, deliberately.** The rows past the cap are
still unreachable. What changes is that a reader can tell which lists are
affected — today the warning fires on every non-empty Bitbucket page and a
reader has no way to separate a whole three-row list from a capped fifty-row
one.

**The REST route was measured and rejected, not assumed.** `bb api` exists, the
endpoint paginates, and the token returns 403. If that token gains scope the
paging fix becomes available and is a better answer than this one; this slice
does not block it.

**Severity rises with PR count**, as the issue says. This repository crossed the
cap in the `merged` state and its open state has not, which is why the board's
open PRs are visible while older merged branches would not be.
