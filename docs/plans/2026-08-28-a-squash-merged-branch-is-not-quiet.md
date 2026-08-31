# A squash-merged branch is not quiet

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** <!-- optional -->
- **Issue:** <!-- optional -->
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-30, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->
- **Started:** 2026-08-31, Jan Wloka, `bug/the-scan-reads-the-merged-pr-list`

## Approval

- **Assignee:** Jan Wloka

## Changelog

A branch whose PR merged leaves QUIET, so the section holds work that stopped
rather than work that shipped.

## Motivation

### What an operator saw

QUIET, 2026-08-28, 28 rows. Eleven were labelled `closed`, and **eight of those
PRs had MERGED** — the label misleads because a squash-merged PR reports
`CLOSED`. Every one of the eight belongs to a finished plan:

| plan phase | branches |
|---|---|
| `released` — shipped in a tag | 6 |
| `delivered` | 2 |

The operator's question was the diagnosis: *"Those belong to delivered plans?"*
They do. QUIET was showing finished work.

### The population, measured

Across every remote branch that is not an ancestor of `origin/main`:

| | count |
|---|---|
| a MERGED PR — squash-merge artefacts | **12** |
| an open PR | 2 |
| no PR at all | 20 |

So a third of the section is work that landed. The 20 with no PR are what QUIET
exists to surface — and among them is real abandonment (`worktree-plot-skills-*`
at 119-120 days, seven `opus5-hardening-*` branches whose PRs were closed
unmerged 33 days ago). **The signal is buried under the noise.**

### Re-measured 2026-08-30: the noise is gone, the signal is not

Every remote branch that is not an ancestor of `origin/main`, counted in full
rather than sampled:

```
              2026-08-28      2026-08-30
total                 34              23
merged PR             12               1     ← the defect's population
open PR                2               1
neither               20              21     ← what QUIET is for
```

**The squash-merge artefacts have drained away** — from 12 to 1 — while the
branches QUIET exists to surface are untouched at 21, `opus5-hardening-*` and
`worktree-plot-skills-*` among them.

**Why they drained is not `plot-release-refs.sh` on its own**: `git log` on main
shows no ref-deletion commits in the last three days, so this is the ordinary
lifecycle catching up rather than a sweep. Either way the population that
motivated the plan is now a single branch.

**What this changes.** The mislabelling is still real — a squash-merged PR
reports `CLOSED`, and one row shows it today. But *"a third of the section is
finished work"* was the case for fixing it, and that case is currently
**1 in 23**. Two readings are available and the plan should say which it takes:

- **the defect is rare now**, so the fix buys little and can wait behind work
  with a live cost
- **the population is volatile** — it was 12 two days ago and will be 12 again
  after the next batch of deliveries, so a fix that only pays off periodically
  still pays off

**The second reading is the stronger one, but it needs stating rather than
assuming.** A plan justified by a measurement that has since collapsed must
either re-argue itself or wait; it must not keep quoting the old number.

### Where it goes wrong, and it is not the classifier

`fleet.ts:3693` already answers correctly:

```ts
if (state === 'merged') {
  // Merged work is DONE, not quiet. "Go check whether it died" is the wrong
  // prompt for a branch that landed …
  return { group: 'done', note: 'merged' };
}
```

The arm is right and the comment already made this argument. The branches never
reach it, because the SCAN never calls them merged. Its rule
(`plot-fleet-scan.sh:2629`):

> A branch is merged when its remote ref is an ancestor of `origin/<main>`, or —
> **once the ref is gone** — when the default branch carries a conforming
> PR-merge commit naming it.

**Squash-merge satisfies neither.** Verified on
`feature/one-wave-renders-as-its-plan`, PR #360 merged 2026-08-23:

```
ancestor of main?              NO      ← squash rewrote the commits
merge commit naming it?         1      ← but it names the PR (#360), not the branch
PR mergedAt?  2026-08-23T19:46:18Z     ← merged three days before it appeared in QUIET
```

The commit is `board: one-wave plan renders its wave's verdict on the plan row
(#360)`. It names the PR NUMBER. And the branch-name fallback only applies once
the ref is gone — this ref still exists, so ancestry decides, and ancestry is
exactly what squash-merge destroys.

### Plot already knows this one component over

`plot-reap.sh` reads `mergedAt` and **never** `state`, with the reason recorded:
squash-merge leaves a branch permanently "ahead of main", so ancestry alone
cleared 1 of 29 finished trees here while the host cleared the other 28.

The reaper asks the host. The scan asks git. They disagree about the same
branches, and the board renders the scan's answer.

## Design

### The scan asks the host, where it is already asking

The scan already fetches a repo-wide `pr-list` on the PR timer — the N+1 fix
four Released plans built. A merged PR's head is in that list. Reading it costs
**no new host call**: the answer is already in hand, and a branch whose head
appears among merged PRs is merged, whatever ancestry says.

Ancestry stays as the first test — it is free, correct for merge-commit
workflows, and answers before any host data is needed. The host answer is the
fallback that catches what squash-merge erased.

### What this plan does not price: a host that cannot be asked

**Challenged 2026-08-30.** This plan's fix is *ask the host where it is already
being asked* — and it mentions a throttled host **zero** times. Its two siblings
were checked the same day: `a-reset-branch-is-not-a-merged-one` cites the risk
four times and states its guard (*"No host call is added. The check is
`rev-list`, offline"*), and `a-throttled-host-says-so` exists because the defect
was reproduced.

**The failure mode is concrete.** `plot-host.sh`'s `pr-list` does not check
`gh`'s exit code and the script runs under `set -uo pipefail` with **no `-e`**,
so a throttled `gh` yields an empty list — indistinguishable from *there are no
merged PRs*. A rule that reads *"a branch appearing among merged PRs is merged,
whatever ancestry says"* then reads every branch as unmerged during a rate
limit, and QUIET fills with work that landed. **That is this plan's own defect,
inverted.**

**So it depends on `a-throttled-host-says-so`, and should say so** — or state
what it does when the list comes back empty for a reason that is not emptiness.

**It also never mentions reset**, which its mirror plan handles explicitly:
a branch reset to the default branch is an ancestor holding nothing, and a fix
aimed only at squash artefacts can make that case worse.

### `mergedAt`, never `state`

A merged PR reports `state: CLOSED`, and this is the third place in this repo
where that distinction decides a behaviour. The test is `mergedAt !== null`, and
the `Done when` list pins it, because reading `state` here would move the defect
rather than fix it.

### Not chosen: filter QUIET by the plan's phase

A branch whose plan is delivered or released could be dropped at the render
layer. Rejected: it fixes the eight that HAVE a plan and misses the four that do
not, it puts merge knowledge in the client where the scan owns it, and it leaves
`state` wrong everywhere else — the same branches are mislabelled in every
section, not only QUIET.

### Not chosen: delete the merged refs and move on

That is the immediate cleanup and it is worth doing (see Notes). It is not the
fix: every future squash merge recreates the condition, and a board that needs
manual pruning to stay legible is one that will drift again by next week.

### Not chosen: widen the branch-name commit search

Dropping the "once the ref is gone" precondition would let the existing
fallback run for live refs. Rejected: the squash commit names the PR NUMBER, not
the branch, so the search finds nothing for exactly the population this plan is
about — verified above.

## Branches

### Merged

- `bug/the-scan-reads-the-merged-pr-list` — `branch_state` falls back to the repo-wide merged-PR list when ancestry says no, reading `mergedAt` and never `state`. Tests: a squash-merged branch whose ref survives reports `merged`; ancestry still answers first and needs no host; a branch with a CLOSED-unmerged PR is NOT merged; no new host call is added, asserted by spawn count

## Done when

1. **A squash-merged branch whose ref still exists reports `merged`.** The
   measured case — 12 branches, `feature/one-wave-renders-as-its-plan` the
   worked example.
2. **QUIET holds only branches that stopped.** The eight belonging to
   delivered/released plans leave; the 20 with no PR stay. Asserted by both
   halves — a fix that empties QUIET has broken it.
3. **A CLOSED-but-unmerged PR is still NOT merged.** The assertion a naive fix
   passes without: reading `state` instead of `mergedAt` satisfies item 1 and
   marks every abandoned branch as landed. Seven `opus5-hardening-*` branches
   are exactly that shape and must stay visible.
4. **Ancestry still answers first**, with no host call, for a branch that is a
   true ancestor. The common path must not acquire a network dependency.
5. **No new host call.** The merged-PR list is already fetched on the PR timer.
   Asserted by spawn/request count, not by duration.
6. **The scan still works offline**, reporting what git alone can prove. The
   existing no-network test covers this and must stay green.
7. `pnpm test`, `pnpm run test:board`, `pnpm run test:reconcile` green.

## Notes

Found by an operator reading QUIET and asking *"what happens here?"*, then
naming the cause a question later: *"Those belong to delivered plans?"*

The immediate estate cleanup — deleting the 12 merged remote refs — is separate
and can be done now; every one is recreatable from its merge commit. This plan
is what stops the condition returning with the next squash merge.
