# A PR list reads every page

> 886 merged pull requests exist, the join sees 50, and the 836 it cannot see read as branches with no PR — while the total and the cursor that fix it are one correctly-formed call away.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #333
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A Bitbucket PR list pages through every result instead of stopping at the first page, so a branch whose pull request is older than the page cap stops reading as having none.

<!-- Board impact: the scan's join sees every PR rather than the newest page.
     No plan format, no template, no layout. -->

## Design

Measured 2026-09-20 on `quaweb-website`:

```
$ bb api "/repositories/quatico/quaweb-website/pullrequests?state=MERGED&pagelen=50"
  size:    886
  pagelen: 50
  values:  50
  next:    YES
```

**886 merged pull requests; the join sees 50.** The other 836 join to nothing
and read as *no PR ever opened* — the fabricated verdict the scan refuses
everywhere else, and #333's whole subject.

| state | total | pages at pagelen 50 |
|---|---|---|
| `OPEN` | 3 | 1 |
| `MERGED` | **886** | **18** |
| `DECLINED` | 13 | 1 |

### The cursor exists and the token can reach it

`bb pr list --json` returns a bare array — no envelope, no cursor — which is why
the adapter cannot page today. But `bb api` reaches the REST endpoint that does,
and the token installed on this machine has the scope.

**A previous plan concluded the opposite and was rejected for it.**
`a-capped-page-says-what-it-hid` measured `bb api "repositories/…"` → **HTTP
403** and inferred the token lacked scope. The path was missing its leading
slash: `bb api` concatenates `"${BB_API}${path}"`, so the URL became
`https://api.bitbucket.org/2.0repositories/…`. With the slash, the same token in
the same shell returns the envelope above.

### What paging costs, and why it is still worth it

Eighteen pages for `merged` on this repository, against one call today. The
latency is real and the alternative is a list that is 94% incomplete.

Two things bound the cost and both are measurable rather than assumed:

- **`size` is in the first envelope**, so the number of pages is known after one
  call rather than discovered by walking.
- **Only `merged` is large here.** `open` and `declined` are one page each, and
  `open` is the state a board refreshes most.

**This plan does not decide the board's refresh strategy.** Whether a board asks
for every merged page on every tick is a cadence question, and the sibling plan
`a-pr-list-costs-one-round-trip` is where call cost is being worked. This one
makes the complete list *available*; it does not make it mandatory on every
timer.

### What must not change

**`pr_list_report_truncation` stays exactly as it is.** Its rule — *"THE DETECTOR
IS AGAINST THE REQUESTED LIMIT, NEVER THE CONSTANT 50"* (`plot-host.sh:1989`),
pinned by `test/reconcile/host.test.mjs:3060` — is correct and was the subject
of the rejected plan. A path that pages completely simply stops being truncated;
a path that cannot page keeps warning. Its current over-firing costs nothing:
`grep -rn 'possibly truncated' packages/board/src packages/domain/src` returns
**zero** consumers.

**The partial classification.** `pr_list_states` counts `_ok`/`_failed` and
returns `PR_LIST_PARTIAL_RC` when some states answered. A page failing mid-walk
is a **failed state**, not a partial answer at the state level — the distinction
`one-exit-code-one-answer` just wired through to the host port.

**The GitHub arm.** `gh` honours `--limit` and pages itself. Untouched.

### What this is NOT

**Not a rewrite of `bb pr list`.** The adapter gains a paging path for
`pr-list`; `bb`'s own command keeps its behaviour for every other caller.

**Not a `--rich` equivalence claim.** `bb pr list --rich` overlays check status
per PR. Whether the REST envelope carries the same fields is the slice's first
question, and if it does not, the slice says so and scopes to the plain list
rather than silently dropping a field.

## Slices

### The adapter walks the cursor (Branch: bug/the-adapter-walks-the-cursor)

- `bug/the-adapter-walks-the-cursor` — the Bitbucket `pr-list` arm pages through `next` until it is empty, and reports the envelope's total

**Done when** a Bitbucket `pr-list --state merged` on a repository with more
than one page returns **every** row, verified against the envelope's `size` —
886 on the measured repository, against the 50 returned today; the request path
carries its **leading slash**, pinned by a test, since its absence is what
produced the 403 that sank the previous plan; the walk terminates on an empty
`next` and cannot loop, pinned with a stubbed two-page response; a page failing
mid-walk makes that **state** fail rather than returning a short list silently —
the direction `plot-fleet-scan.sh:846` already rules on (*"Deriving absence from
a partial list would report a real PR as having none — strictly worse"*); the
slice states whether the REST envelope carries `--rich`'s check fields and
scopes accordingly rather than dropping one; `pr_list_report_truncation` is
**unchanged** and `host.test.mjs:3060` passes unedited; the partial
classification across states is unchanged; the GitHub arm is untouched, pinned;
and `pnpm run test:contracts` passes.

## Notes

**This plan exists because its predecessor was rejected on a typo.**
`a-capped-page-says-what-it-hid` proposed narrowing a warning as a proxy for a
number it believed unknowable. The number is `size`, the cursor is `next`, and
both were behind one missing `/`. The panel record is at
`.plot/panels/2026-09-20-a-capped-page-says-what-it-hid/`.

**The severity is larger than #333 estimated.** The issue says *"severity is low
today … and rises with PR count"*. On the reporting repository it is already
**836 invisible pull requests**, which is 94% of the merged history.
