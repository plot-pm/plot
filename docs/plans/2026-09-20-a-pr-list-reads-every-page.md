# A branch asks about its own PR

> The join answers *does this branch have a pull request* for a dozen branches, and pays for it by listing a repository's entire history — of which it discards 98%.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #333
- **Review:** in-session
- **Rounds:** 1
- **Impl:** own branches

## Changelog

- A Bitbucket PR lookup asks the host about the branches it is tracking rather than listing every pull request in the repository, so a branch whose pull request is older than the first page stops reading as having none.

<!-- Board impact: the scan's join gets a complete answer per branch. No plan
     format, no template, no layout. -->

## Design

Measured 2026-09-20 on `quaweb-website`:

| state | total | rows the join receives today |
|---|---|---|
| `OPEN` | 3 | 3 |
| `MERGED` | **886** | **50** |
| `DECLINED` | 13 | 13 |

**836 merged pull requests are invisible to the join.** They resolve to *no PR
ever opened* — the fabricated verdict `plot-fleet-scan.sh:876` rules against:
*"Deriving absence from a partial list would report a real PR as having none —
strictly worse."* That is #333, and on this repository it is 94% of the merged
history rather than the *"low today"* the issue estimated.

### The join is keyed by branch, and discards almost everything it is given

`fleet.ts:2522` and `:2534` index by `pr.head`. Every row whose head is not a
branch the board tracks is dropped on arrival. Measured: **12 board rows, 11
remote branches under the configured prefixes** — against 902 rows a complete
listing would emit. **The join uses about 1%.**

### The REST endpoint answers per branch, in one call

`bb pr list` has no branch filter. The REST endpoint does, through the same `q=`
form `bb` already builds for `--author`. Measured:

```
$ bb api "/repositories/quatico/quaweb-website/pullrequests?q=state%3D%22MERGED%22%20AND%20source.branch.name%3D%22feature/ki-anwendungen-unter-angebote%22&pagelen=50"
  size: 1 | values: 1 | next: no | ids: 902

$ … source.branch.name="nonexistent-branch-xyz" …
  size: 0
```

One call, exact, complete — and `size: 0` is an **honest absence** rather than a
failure, which is the distinction the guard above protects. PR **902** is one of
the 836 a listing cannot reach.

**The leading slash is load-bearing.** `bb api` concatenates
`"${BB_API}${path}"`, so omitting it yields `…/2.0repositories/…` and an HTTP
403 that reads like a scope problem. A previous plan was rejected for inferring
exactly that.

### Why not page the list — the shape this plan rejected

An earlier version of this plan walked `next` through all 18 merged pages. Two
lenses refuted it and the refutations are measurements:

**The cadence is derived, not configured.** `fleet.ts:184` hardcodes
`bitbucket: 4` requests per refresh and `prRefreshMsFor` stretches the interval
by it so hourly spend stays 60. Paging makes it ~21, and the interval follows
mechanically:

| | cost | interval |
|---|---|---|
| today | 4 | **240 s** |
| paged | 21 | **1260 s — 21 minutes** |

On a busy account `MAX_CADENCE_STRETCH = 8` takes the worst case to **2.8
hours**. Under-declaring the cost instead is the failure `fleet.ts:176` names:
*"an under-counted cost under-stretches the cadence, and an under-stretched
cadence against an already-hit limit is the failure this measurement exists to
prevent."*

**And the growth curve is backwards.** Paging costs grow with the repository's
PR history — the very thing #333 says the severity rises with. A per-branch
query costs what the board tracks and is **constant in PR count**.

The shapes cross over: 11 branches against 18 pages today, and a repository with
60 tracked branches would pay more. That comparison is why this plan states both
numbers; the earlier version measured only 886 and never counted the branches.

### What this must not break

**The completeness guard.** `plot-fleet-scan.sh:900` writes `.list-complete`
only when `0 < rows < PR_LIST_LIMIT`, and derives `NONE` from a cache miss only
then. Its signal is *"fewer rows than I asked for"* — which a per-branch answer
does not produce at all, since each query returns 0 or 1. **The slice must say
what tells the scan its answer is complete**, or the guard silently stops
licensing `NONE` and every branch resolves to `-`. An 18-page walk hits the same
wall from the other side at 1000+ rows.

**`pr_list_report_truncation` keeps its rule** — *"THE DETECTOR IS AGAINST THE
REQUESTED LIMIT, NEVER THE CONSTANT 50"* (`plot-host.sh:1989`), pinned by
`host.test.mjs:3060`. Its **comment** states a premise this plan falsifies
(*"cannot report a total or a cursor"*); the comment is corrected, the behaviour
is not. It has **zero** consumers — `grep -rn 'possibly truncated'
packages/board/src packages/domain/src` → 0 — so its over-firing costs nothing.

**The `--rich` fields.** A REST PR object must supply what the arm emits, or the
slice scopes to the plain list and says so rather than dropping a field
silently.

## Slices

### A branch asks about its own PR (Branch: bug/a-branch-asks-about-its-own-pr)

- `bug/a-branch-asks-about-its-own-pr` — the Bitbucket arm gains a per-branch PR query, and the scan learns that its answer is complete

**Done when** a Bitbucket lookup for a branch whose merged PR is older than the
first page **finds it** — PR 902 on `feature/ki-anwendungen-unter-angebote` is
the measured case, invisible today; the request path carries its **leading
slash**, pinned, since its absence produces a 403 that reads as a scope error;
a branch with no PR returns an **honest absence** distinguishable from a
failure, pinned with both a 200/`size: 0` and a refused call; **the slice names
what carries completeness to `plot-fleet-scan.sh:900`** and pins that
`.list-complete` is still written when it should be — without this the guard
stops licensing `NONE` and every branch resolves to `-`; the number of host
calls is proportional to **tracked branches**, not to PR history, stated with
both numbers on the measured repository (11 branches, 886 merged PRs); the cost
declared in `PR_REQUESTS_PER_REFRESH` matches what the arm now makes, so the
cadence stretches for the truth rather than for 4; `pr_list_report_truncation`'s
behaviour is unchanged and `host.test.mjs:3060` passes unedited, while its
comment's falsified premise is corrected; the `--rich` field set is either
supplied or the slice scopes down and says which field it dropped; the GitHub
arm is untouched, pinned; and `pnpm run test:contracts` passes.

## Notes

**Rewritten after a two-lens panel** (`.plot/panels/2026-09-20-a-pr-list-reads-every-page/`).
Both lenses returned `amend` and both independently reached the same conclusion
from different directions: the cost lens by computing the 21-minute cadence and
finding the targeted query, the adapter lens by finding that a complete list
makes `plot-fleet-scan.sh`'s completeness guard fire backwards.

**The adapter lens answered the question the plan called its first.** The REST
envelope does carry what `--rich` needs — that was the decisive risk and it
resolved in the plan's favour.

**`pagelen=100` is refused by Bitbucket** (HTTP 400), so 50 is at the ceiling
and 18 pages was a floor rather than a conservative choice. There was no cheaper
paging shape to find.

**`bb`'s own paginator caps at 10 pages** (`bb:203`) — 500 rows at `pagelen=50`,
386 short of 886, exiting with no error and no marker. Any future slice that
does page must not reach for that helper.
