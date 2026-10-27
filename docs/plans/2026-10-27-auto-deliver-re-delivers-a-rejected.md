# Auto-deliver re-delivers a rejected plan whose slice PR carried only its claim

> Auto-deliver holds a rejected plan in Approved until a branch merges after the rejection, and counts no slice PR that changes nothing beyond its claim.

## Status

- **State:** Draft
- **Type:** feature
- **Issue:** #2713
- **Review:** pr
- **Impl:** own branches

## Changelog

- Auto-deliver no longer re-delivers a plan after `/plot-reject` moved it back to Approved, and no longer reads a merged slice PR that holds only its claim as delivered work.

<!-- Board impact: none expected. The change reads existing Status records; it adds no plan field and no helper script. -->

## Motivation

On 2026-10-26, `/plot-reject` moved `plot-host-bitbucket-pr-list-reads` (#2400) from Delivered to Approved at 15:38:04 (`6666041ff`). Fleetd's auto-deliver delivered it again at 15:38:47 (`c67b5cd1f`), 43 seconds later. The plan file holds a `Rejected:` record followed by a second `Delivered: 2026-10-26`, the index symlink is back in `delivered/`, and the sprint item in `2026-W43-bugfix-2-28-2.md` is ticked again.

The plan's only branch has PR #2422 merged. That PR holds the claim commit and the blocker commit `f576060de` ("No code change follows"). `bb_state_listing` on `origin/main` still reads one page. The first delivery (`b2df79eaf`, 14:19 UTC) came from the same auto-deliver path.

Effect: the next release publishes #2400's Changelog line for a change that is not on main. The paging now belongs to slice 1 of `read-merged-prs-from-the-merge` (#2419).

Two defects cause this. `packages/fleet/src/shared/auto-deliver.ts` delivers every plan whose non-deferred branches have all merged, and it reads no `Rejected:` record, so a rejection cannot hold while the slice PRs read as merged. A merged PR that carries only its claim counts as a merged slice, although the merge watcher already refuses such a PR as "changes no file beyond its claim".

## Design

### Approach

1. **Rejection hold.** Auto-deliver skips a plan whose latest Status record is `Rejected:`, until a branch merges after the date of that record. The rule belongs in the domain (`planAutoDeliver` and its readings), not in `auto-deliver.ts`, so a unit test asserts it without a fleet run.
2. **Claim-only slice.** Auto-deliver does not count a slice PR whose diff holds nothing beyond `.plot/claims/` as delivered work. The domain reuses the merge watcher's definition of "changes no file beyond its claim" rather than adding a second one.
3. **Corpus pair.** If the claim-only test exists in both TypeScript and shell, the pair joins the corpus tier (`packages/domain/corpus/`) per the shell-and-domain contract.

### Open Questions

- [ ] "Until a branch merges after that date": does the comparison use the PR's `mergedAt` (host answer) or the `Rejected:` record's date, which carries a day and no time? A same-day merge after a same-day rejection must resolve the same way on both hosts.
- [ ] Does a claim-only slice block delivery (plan waits) or count as not-merged (slice re-opens)? The board's `deliverable` state and `/plot-deliver` must agree with auto-deliver, or a person delivers by hand what the fleet refuses.
- [ ] Does `/plot-deliver` by hand gain the same checks, or only the unattended path? The controller-gate rule says a refusal ends the action, which argues for one shared rule.

## Slices

### Rejection hold

- `bug/auto-deliver-holds-a-rejected-plan` — `planAutoDeliver` skips a plan whose latest Status record is `Rejected:` until a branch merges after it; test: reject a delivered plan with all slices merged, run the pass, assert no delivery.

### Claim-only slice

- `bug/auto-deliver-ignores-a-claim-only-slice` — a merged slice PR whose diff holds only `.plot/claims/` does not count as delivered work; reuses the merge watcher's definition.

## Notes

- Source: issue #2713 (https://github.com/plot-pm/plot/issues/2713). The issue is the problem statement; the plan's `Issue:` field is the only link and nothing is written to the tracker.
