# Delivery reads one source

> Delivery reads the plan, its phase and its merged slices from the source the pulse reads, so a finished plan is deliverable and a host that cannot answer refuses as "cannot tell", never as "not merged".

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** the-release-train-fixes-what-it-found
- **Issue:** #1280, #1336, #1165
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-10-07, jwloka, in-session
- **Started:** 2026-10-07, jwloka, `bug/deliver-reads-the-plan-at-the-pulse-ref`
- **Started:** 2026-10-08, jwloka, `bug/deliver-reads-the-pr-index-first`

## Changelog

- `POST /api/deliver` finds a plan through its dated plan file and reads its phase at the ref the pulse was read from, so a plan whose slices all merged is deliverable, and a plan that `origin` already delivered answers `already-delivered`.
- Delivery counts a slice as merged from the PR store's `MERGED` rows first and asks the host only for the rest. A host answer of `unknown` refuses as "cannot tell", never as "not merged", and the refusal names the real merged count.

<!-- Board impact: Both slices change board server code; main rebuilds the shipped bundles after each merge. No change to the plan format, the plan template or the docs/plans layout. -->

## Motivation

Three issues (#1165, #1280, #1336) report that delivery refused a finished plan. Each refusal read a different source than the pulse it was compared with:

- **Delivery refuses finished plans.** `resolvePlanBySlug` returns the active symlink first (`packages/board/src/server/deliver.ts:162-163`). `landed()` and `deliveryPulse` join on that basename (`packages/domain/src/rules/deliverable.ts:133`, `:254`), and the pulse names the dated file, so every Approved plan reads `not-merged` (#1280). The phase comes from the working tree (`deliver.ts:214-231`), while the pulse comes from `origin/main`, so a stale checkout refuses a plan that `origin` already delivered (#1336).
- **A 429 reads as "not merged".** `controllers/deliverability.ts:86` asks `host.prMerged` once per branch. An `unknown` answer counts as not merged. A 12-slice plan on Bitbucket sends about 60 requests and gets 12 `unknown` answers (#1165).

## Design

### Approach

**One slice per fix, one branch per slice.** Each slice carries its own test and changeset, and a rebuild where it touches the board. The slices run in heading order, because a slice is eligible only when every prior slice has merged (`packages/domain/src/rules/eligible.ts:131-134`). Slice 1 comes first because it fixes a refusal of every Approved plan; slice 2 fixes a refusal under a rate limit.

**Slice 1, the plan at the pulse ref (#1280, #1336).** `deliverability()` resolves the real plan file (`docs/plans/<date>-<slug>.md`) and never the active symlink, and it reads the plan's phase with `git show <readRef>:<plan file>`, where `readRef` is the ref the pulse was read from. `landed()` and `deliveryPulse` then join on the same dated basename the pulse uses. A plan that `origin` delivered while the checkout is behind answers `already-delivered`.

**Slice 2, the PR index first (#1165).** `mergedBranches` in `controllers/deliverability.ts` reads the PR store's `MERGED` rows through `decodePrIndex` and asks `host.prMerged` only for the branches the store does not answer, as `plot-impl-status.sh` does. Only a terminal `MERGED` row answers, as *A Decision Reads The Index* in `CLAUDE.md` requires. Any `unknown` answer refuses as `cannot-tell` and names the host's words. The refusal reports the real merged count.

### Open Questions

None.

## Slices

### Deliver reads the plan at the pulse ref

- `bug/deliver-reads-the-plan-at-the-pulse-ref` — resolve the dated plan file, read its phase at the pulse's read ref, join `landed()` and `deliveryPulse` on the dated basename; tests through `docs/plans/active/` and with a stale checkout <!-- builds: the plan phase read at the pulse's read ref -->

### Deliver reads the PR index first

- `bug/deliver-reads-the-pr-index-first` — `MERGED` rows from the PR store first, the host for the rest, `unknown` refuses as `cannot-tell` with the real merged count <!-- builds: mergedBranches over the PR store -->

## Done when

Each test below fails on `origin/main` (`a778bda0d`) today:

- Slice 1: a deliver-route test resolves a plan through `docs/plans/active/` and answers `deliverable` for a plan whose slices all merged; a second test holds the plan Delivered at the read ref and Approved in the working tree, and answers `already-delivered`.
- Slice 2: a 12-branch plan whose store holds 12 `MERGED` rows is deliverable with zero host calls; a host `unknown` for one branch refuses as `cannot-tell` with `merged: 11`.
- `node skills/plot/scripts/board/plot-local-checks.mjs` and the commands it prints pass on each branch.

## Notes

- 2026-10-07, direction from jwloka: the release train's open findings split by theme into four plans that run in parallel with each other, each slice as the triage on `a778bda0d` stated it; Type bug; reviewed in-session; own branches.
- The four plans `delivery-reads-one-source`, `the-fleet-loop-reads-its-runs-right`, `a-controller-owns-what-it-starts` and `the-tests-and-sweeps-leave-no-trace` replace the Draft plan `the-release-train-fixes-what-it-found`, which was never approved. Separate plans run in parallel, and the slices inside one plan run in order.
- Deliverable search, 2026-10-07:
  - Slice 1: `resolvePlanBySlug` has private copies in `approve.ts:120`, `commission.ts:117` and `deliver.ts:147`, each a copy of `transition.ts`'s. The fix changes the deliver copy; the other two resolve the same symlink and are a candidate for one shared resolver.
  - Slice 2: `mergedBranches` exists twice with different inputs: `auto-dispatch.ts:162` over the pulse and `controllers/deliverability.ts:80` over the host. `decodePrIndex` is read through `entry/pr-index-lookup.ts`.
