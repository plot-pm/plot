# A reset branch is not a merged one

## Status

- **Phase:** Delivered
- **Type:** bug
- **Sprint:** the-domain-is-one-implementation
- **Issue:** <!-- optional -->
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-30, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, branch -->
- **Delivered:** 2026-08-31
- **Released:** <!-- YYYY-MM-DD, version -->
- **Started:** 2026-08-30, Jan Wloka, `bug/an-empty-branch-reads-open`

## Approval

- **Assignee:** Jan Wloka

## Changelog

A slice whose branch was reset to the default branch reads `open`, not
`complete` — so a wave does not open on work nobody did.

## Motivation

### Measured 2026-08-29, on a slice being rebuilt

`feature/one-deliver-rule-decides-in-the-domain` was reset to `origin/main` so a
worker could rebuild it from scratch. Its PR (#511) had been **closed, never
merged** — `merged_at` is null. Seconds after the reset, the scan reported:

```
  Deliverable — complete
      feature/one-deliver-rule-decides-in-the-domain — merged
  Transitions — eligible
      feature/a-transition-is-one-value — open
```

**Neither line is true.** The slice's work does not exist — the branch is
byte-for-byte the default branch — and `Transitions` became eligible on the
strength of it.

### Why the scan says it

A branch pointing **at** the default branch is trivially an ancestor of it, so
every ancestry test passes. The scan reads that as *landed*, which is right for
the case it was built for — a squash merge leaves the branch behind and
`merged_by_subject` recovers the evidence from main's history — and wrong for
this one, where the same shape means the branch holds **nothing**.

**The host disagrees and is not asked here.** `#511 merged=false` is one REST
call away; `plot-pr-merged.sh` already exists and already reads `mergedAt`
rather than `state`, precisely so a closed PR is not mistaken for a merged one.

### The cost is a wave opened on nothing

Slice ordering is Plot's one gate against building on an unproven seam
(`DESIGN-slice.md`: *"a slice becomes eligible only once every non-deferred
branch in every prior slice is merged, so this never hands you work that builds
on an unproven seam"*). A slice that reads `complete` because its branch is
empty opens the next one on a seam that was never built.

**Here it was harmless** — the rebuild is in flight and `Transitions` was not
dispatched. It would not be harmless unattended: `--next` offers the branch,
auto-dispatch claims it, and a worker starts against an import that does not
exist yet.

## Design

### An empty branch is not evidence of anything

The fix is one question, asked where ancestry already answers: **does this
branch differ from the default branch at all?**

```
git rev-list --count origin/<main>..origin/<branch>   → 0
```

Zero commits ahead means the branch carries no work. That is not *merged* — it
is *indistinguishable from not having started*, and the honest word for a slice
in that state is `open`.

**This does not weaken squash-merge detection**, which is the case ancestry
exists for: a squash-merged branch is *behind* main but has commits main does
not contain by subject, so `merged_by_subject` still finds them. A branch at
zero-ahead has nothing to find.

### Challenged 2026-08-30: three plans, one question, and this is the careful one

**`a-squash-merged-branch-is-not-quiet` is this plan's mirror**, and the pair is
worth seeing together:

| | ancestry says | truth | the error |
|---|---|---|---|
| **squash-merged** | not an ancestor → *open* | merged | work shown as unfinished |
| **reset to main** | is an ancestor → *merged* | holds nothing | nothing shown as finished |

**A fix for one can break the other**, because both live in the gap between
ancestry and the host's answer. This plan handles that explicitly — it reasons
about `merged_by_subject` and says why a squash-merged branch keeps working
under its rule. **The squash plan does not mention reset at all** (`grep`:
6 mentions here, 0 there), which is a gap on that side rather than this one.

**And this plan is the only one of the three that priced the throttled host.**
It cites `a-throttled-host-says-so` and states the guard: *"No host call is
added. The check is `rev-list`, offline."* The squash plan adds host calls and
mentions throttling **zero** times — measured the same day the throttle plan's
own defect was reproduced.

**Nothing here needs changing.** Recorded because the three form a set, and
whichever lands first should be read against the other two.

### Where the host already knows

`plot-pr-merged.sh` answers *did the host merge ANY PR for this branch?* and
already refuses to read `state` (a merged PR reports `CLOSED`). This plan's
check is the git-side companion: cheap, offline, and decisive in the one case
where ancestry lies.

**Ask git first, the host second.** The zero-ahead test costs one `rev-list` and
needs no network — which matters, because the same afternoon showed the host
answering *not merged* for three genuinely merged branches while throttled
([`a-throttled-host-says-so`](2026-08-29-a-throttled-host-says-so.md)).

### Not chosen: refuse to reset a branch to main

It would remove the shape rather than report it, and the reset is legitimate —
it is how a slice is rebuilt after its first attempt is rejected. The estate
should describe what is there, not forbid a state it can describe.

## Waves

### Reading (Branch: bug/an-empty-branch-reads-open, PR: #546)

`plot-fleet-scan.sh` treats a branch with zero commits ahead of the default
branch as `open` rather than `merged`, before any ancestry claim is made.

Tests: a branch reset to main reads `open` and leaves the next slice `blocked`;
a squash-merged branch still reads `merged`; a branch with real commits ahead is
untouched.

## Done when

1. **A branch pointing at the default branch reads `open`.** Asserted directly:
   reset a branch, scan, read the slice.
2. **The next slice stays `blocked`** in that state — the ordering gate is the
   thing being protected, so assert on it and not only on the row.
3. **Squash-merge detection is unchanged.** The case ancestry exists for must
   still work; assert it on a branch merged by squash, unedited.
4. **No host call is added.** The check is `rev-list`, offline — a throttled
   host must not turn this into a wrong answer, and the same afternoon showed
   what a throttled host does to merge questions.
5. `pnpm test`, `pnpm run test:reconcile` green.

## Notes

Found while preparing the next slice: the scan had already opened `Transitions`
on a Deliverable slice whose branch was empty. Harmless because a person was
watching; the failure mode is auto-dispatch claiming that branch and a worker
starting against an import that does not exist.
