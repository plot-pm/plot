# Implementation brief — a-squash-merged-branch-is-not-quiet (Merged)

- **Plan (canonical):** `docs/plans/2026-08-28-a-squash-merged-branch-is-not-quiet.md` on main
- **Branch:** `bug/the-scan-reads-the-merged-pr-list` (base: `main`)
- **Ends as:** one PR to main
- **The plan's only slice.**

### What to build

`branch_state` falls back to the repo-wide merged-PR list when ancestry says no,
reading `mergedAt` and **never** `state` — a merged PR reports `CLOSED`.

### Read the plan's own re-measurement first

**The motivating population drained from 12 to 1.** Counted in full on
2026-08-30, across every remote branch that is not an ancestor of `origin/main`:

```
              2026-08-28      2026-08-30
merged PR             12               1
open PR                2               1
neither               20              21
```

**The defect is still real** — one row shows it today — but *"a third of the
section is finished work"* is no longer the case. The plan records both readings
and takes the second: the population is **volatile**, it was 12 two days ago and
will be 12 again after the next batch of deliveries, so a periodic payoff is
still a payoff.

**Say in the PR which reading you are shipping against.** A slice justified by a
number that has since collapsed should re-argue itself rather than quote the old
one.

### Two dependencies the plan gained after it was written

**1. It adds host calls and never mentions a throttled host.**
`plot-host.sh`'s `pr-list` does **not check `gh`'s exit code**, and the script
runs under `set -uo pipefail` with **no `-e`** — so a throttled `gh` yields an
empty list, indistinguishable from *there are no merged PRs*. Reproduced
2026-08-30 against a nonexistent repo: `exit=1`, stdout empty.

**A rule reading *"a branch among merged PRs is merged, whatever ancestry
says"* therefore reads every branch as unmerged during a rate limit** — this
plan's own defect, inverted. [`a-throttled-host-says-so`](2026-08-29-a-throttled-host-says-so.md)
fixes the adapter and is approved and briefed. **Either land after it, or say
what your fallback does when the list comes back empty for a reason that is not
emptiness.**

**2. Its mirror plan handles a case this one never mentions.**

| | ancestry says | truth |
|---|---|---|
| squash-merged | not an ancestor → *open* | merged |
| **reset to main** | is an ancestor → *merged* | **holds nothing** |

`a-reset-branch-is-not-a-merged-one` is approved and briefed. **Ancestry must
still answer first** — your fallback runs only when ancestry says no, so the
reset case never reaches it. Keep it that way.

### Done when

The plan's list, and the fourth is the one that could be lost quietly:

- a squash-merged branch whose ref survives reports **`merged`**
- **ancestry still answers first and needs no host** — a branch that is an
  ancestor must resolve with zero host calls
- a branch with a **CLOSED-unmerged** PR is **not** merged (`mergedAt` is null;
  `state` would say `CLOSED` for both)
- **no new host call is added, asserted by spawn count** — the repo-wide merged
  list is already fetched on the PR timer, and this must read it rather than ask
  again

**A vacuous pass to avoid:** testing only against a fixture where the merged
list is populated. Assert the empty-list case too — and after the throttle fix,
assert that an *unaskable* host does not silently produce "not merged".

Plus: `pnpm test`, `pnpm run test:reconcile`, changeset with a `bumps: skills:`
block.

### Scope guard

`branch_state`'s fallback. Not the reset case, not the host adapter, not QUIET's
rendering.

If the merged list turns out not to be available where `branch_state` runs,
**report it** — fetching it there is a new host call, which the fourth done-when
forbids.
