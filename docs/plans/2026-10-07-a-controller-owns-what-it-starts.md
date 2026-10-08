# A controller owns what it starts

> `POST /api/continue` refuses a desk whose loop still runs and starts its loop outside the board, and a new controller releases a branch claim, so a master agent needs no bypass for either act.

## Status

- **State:** Delivered
- **Type:** bug
- **Sprint:** the-release-train-fixes-what-it-found
- **Issue:** #1294, #1307, #1276
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-10-07, jwloka, in-session
- **Started:** 2026-10-07, jwloka, `bug/continue-owns-the-desk-it-starts`
- **Started:** 2026-10-08, jwloka, `bug/a-claim-has-a-release-controller`
- **Delivered:** 2026-10-08

## Changelog

- `POST /api/continue` refuses a desk whose loop is still alive, and starts the continued loop outside the board's process tree, so a board restart does not stop a continued agent.
- `POST /api/release-claim {branch}` releases a branch claim through the domain, refuses a branch with a live agent or an open PR, and is reachable through `plot-ask.mjs`.

<!-- Board impact: Both slices change board server code; main rebuilds the shipped bundles after each merge. Slice 2 adds one route, `POST /api/release-claim`. No change to the plan format, the plan template or the docs/plans layout. -->

## Motivation

Two lifecycle acts have no controller that owns their result. *The Master Agent Uses The Controllers* in `CLAUDE.md` names such a gap as the finding:

- **Continue runs two loops on one desk.** `continueOnDesk` never stops or refuses a live loop (`packages/board/src/server/continue.ts:457`, `:802`). On 2026-10-05 three loops ran on one desk (#1294). The continued loop is a child of the board, and `plot-boardctl.sh` stop sends TERM to the whole tree (`tree_pids`, `plot-boardctl.sh:173`, `:532-536`), so a board restart stops every continued agent (#1307).
- **No controller releases a claim.** A master agent needs the counted bypass to release a stale claim (#1276).

## Design

### Approach

**One slice per fix, one branch per slice.** Each slice carries its own test and changeset, and a rebuild where it touches the board. The slices run in heading order, because a slice is eligible only when every prior slice has merged (`packages/domain/src/rules/eligible.ts:131-134`). Slice 1 comes first because two loops on one desk corrupt work; slice 2 removes a counted bypass. `every-loop-ending-has-a-supervisor-rule` slice 1 waits on slice 2 of this plan.

**Slice 1, continue owns its desk (#1294, #1307).** `continueOnDesk` reads the desk manifest's `pid` and `wrapperPid`. While that loop is alive, it refuses with `loop-alive` and names the pid. When no loop is alive, it starts the new loop through the registry supervisor's start path, detached in its own session, with its pid in the manifest as a dispatched loop has. `plot-boardctl.sh` stop then finds no agent in the board's tree.

**Slice 2, the claim release controller (#1276).** A domain workflow `releaseClaim` takes the branch, the readings of its agent and its PR, and answers `release` or a refusal: `agent-live` or `pr-open`. `POST /api/release-claim {branch}` calls it and runs the release through the adapter that `--release` uses today. `plot-ask.mjs release-claim <branch>` reaches the same route without HTTP.

### Open Questions

- [ ] Slice 1: should `continue` stop a live loop and then start, instead of refusing? The issue allows both. The plan refuses, because a stop can lose a turn in progress.

## Slices

### Continue owns the desk it starts

- `bug/continue-owns-the-desk-it-starts` — refuse a desk with a live loop; start the continued loop detached, outside the board's process tree <!-- builds: the loop-alive refusal and a detached continue --> → #1351

### A claim has a release controller

- `bug/a-claim-has-a-release-controller` — `releaseClaim` in the domain, `POST /api/release-claim`, `plot-ask.mjs release-claim` <!-- builds: POST /api/release-claim --> → #1363

## Done when

Each test below fails on `origin/main` (`a778bda0d`) today:

- Slice 1: a test starts a loop on a desk and calls continue; continue refuses with `loop-alive`, exactly one loop runs, and the manifest survives. A continued loop survives `plot-boardctl.sh` stop.
- Slice 2: `releaseClaim` refuses `agent-live` and `pr-open` and answers `release` otherwise; `plot-ask.mjs release-claim <branch>` removes the claim ref.
- `node skills/plot/scripts/board/plot-local-checks.mjs` and the commands it prints pass on each branch.

## Notes

- 2026-10-07, direction from jwloka: the release train's open findings split by theme into four plans that run in parallel with each other, each slice as the triage on `a778bda0d` stated it; Type bug; reviewed in-session; own branches.
- The four plans `delivery-reads-one-source`, `the-fleet-loop-reads-its-runs-right`, `a-controller-owns-what-it-starts` and `the-tests-and-sweeps-leave-no-trace` replace the Draft plan `the-release-train-fixes-what-it-found`, which was never approved. Separate plans run in parallel, and the slices inside one plan run in order.
- Deliverable search, 2026-10-07:
  - Slice 1: `continueOnDesk` (`continue.ts:596`) is also called by the supervisor (`entry/registryd-main.ts:1562`), so the refusal reaches both callers.
  - Slice 2: no `releaseClaim` or `/api/release-claim`; `/api/release` cuts a version release, a different act.
