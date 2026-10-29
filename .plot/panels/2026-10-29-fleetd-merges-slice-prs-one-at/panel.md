# Panel moderation: fleetd-merges-slice-prs-one-at

Reconcile: **unanimous amend** (layering, safety, testability, seams). Executed evidence: four jurors ran probes against `merge()` and `defaultBranchRed()` (esbuild bundles and scratch vitest); testability ran `workflows-merge`, `default-branch` and `queue` (239/239); layering read this machine's live `default-branch.json`; safety read ruleset 24412719 and `gh` identity read-only.

## Agreed by all four

1. **Nothing enforces one merge in flight, and the controller cannot see the merge fleetd just made.** Executed by all four: `merge()` decides MERGES for (a) a pending head past a green settled commit, (b) a reading that still names the pre-merge head, (c) no reading at all (`merge.ts:121`). Layering saw (a) live: head `5163dbee` pending, settled `88ab8e4b`. The reading is refreshed on the 60 s PR beat while writes run on the 5 s scan beat (`fleet-clock.ts:21-35`, `registryd-main.ts:2493-2538,2598,2615`), so about 11 scans after a merge still read the old head. Amendment: `merge()` gains a `default-branch-unsettled` refusal; the caller re-reads the tip through `Refs.remoteSha` (`git ls-remote`); compare the reading's `at` with the newest MERGED `mergedAt` in the index; at most one merge per pass; a `null` reading holds an unattended merge.
2. **The review record has no source in the index** (same finding as #2900's panel). The rule cannot tell "no review" from "no HIGH"; `checks: green` includes `plot/review` as success-or-absent.
3. **The dependency is misnamed.** The merge path has no unattended refusal (`workflows/merge.ts:11-19`, `entry/merge.ts:48-75`, `main.ts:150-176`), so a caller identity unblocks nothing. What this plan needs from #2900 is `slicePrNext`, the review record, the scope reader and the tick wiring; slice 1 extends `slicePrNext` with a `waits:` on #2900's branch rather than repeating its `builds:`.
4. **`mergeAt` lives in `packages/board`; `@plot-pm/fleet` depends only on domain.** This plan owns moving it into the domain (or pays the spawn-ratchet cost of starting `plot-ask.mjs`).
5. **Two facts are wrong.** `default-branch-red` is the dispatch hold and lifts on a stale reading (`rules/default-branch.ts:262-270`, `queue.ts:583`); the merge refusals at `merge.ts:121-128` hold on stale. Executed: the two answer differently on one reading. The rule needs its own stale arm.

## Sibling seams

- **A ticketed HIGH never merges** (seams, all corroborate via #2903's panel): #2903 ends in "merge" while this plan merges only on "no HIGH". The predicate becomes "`plot/review` is `success` on this head", re-asked by the controller (`review-not-passed` refusal; safety: a missing status can fold to green).
- **Repair and revert PRs cannot merge on red** (`merge.ts:127`; #2904's seams juror executed it). #2904 owns the narrow exception.

## Safety findings the others did not see

- **The fleet would merge with bypass rights today.** Ruleset 24412719 gives the Admin role `bypass_mode: always`; the signed-in `gh` identity is admin; this repo declares no `Merger app`, so `plot-host.sh pr-merge` merges as that identity (`plot-host.sh:4442-4453`). `docs/review-status-rollout.md:153`: "Declare `Merger app` to close it."
- Merges run in the looping daemon only, never `--once`.
- No retry after `host-refused` at the same head; a head with no declared CI run never settles and holds the queue forever — name a bound.

## Shared blind spot

All four measured the guard against fleetd's own merges and a person's. None asked about the changesets bot or auto-merge (`allow_auto_merge` is on, per #2900's safety juror): a merge neither the fleet nor a person started still has to be counted as in flight, which the tip re-read covers only if every merge path is read from the tip.

## For the person

- Require a `Merger app` before fleetd merges on GitHub (closes the admin bypass), or accept merges as the admin identity?
