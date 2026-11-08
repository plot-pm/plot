# An ended main-repair episode leaves its claim ref, and the board reads it as commits

> A repair episode that ends with main green again and no repair commit leaves its `bug/main-repair-<sha>` claim ref and desk, and the board's Quiet section reads that claim-only branch as `commits, no PR ever opened — abandoned`. The episode releases its claim when it ends, and the board names a claim-only branch as a claim with the release as its action.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:**
- **Issue:** #3235
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:**

## Changelog

- A main-repair episode that ends with no repair commit releases its `bug/main-repair-*` claim ref and desk.
- The board shows a branch whose only commits beyond the default branch are empty `plot: claim` markers as a claim, with the release as its action.

Board impact: the second slice changes how the board classifies a Quiet row; rebuild the board artifact if the served payload changes.

## Motivation

Three `bug/main-repair-<lastGreenSha>` branches stayed on origin after their episodes ended (issue #3235):

| Branch | Claimed | Content |
|---|---|---|
| `bug/main-repair-fcc797085ba9` | 2026-11-03 | `81fcd1fac plot: claim …` only |
| `bug/main-repair-e54e5381561a` | 2026-11-04 | `23e155394 plot: claim …` only |
| `bug/main-repair-9c77fff4cc8e` | 2026-11-06 | `52189061e plot: claim …` only |

`.plot/state/repair-record.json` reads `state: done` and `attempt: {branch: bug/main-repair-9c77fff4cc8e, outcome: ended}`. Main recovered by a rerun, so no repair agent committed. The refs stayed until a person ran `plot-dispatch.sh --release` on 2026-11-08. The board listed all three as `commits, no PR ever opened — abandoned`, although the only commit on each is the empty claim marker.

Two defects follow:

1. Closing an episode with outcome `ended` does not release the claim. `repair-start.ts` records `ended` and starts nothing, and no step after it gives up the ref.
2. The board's quiet-kind reading (`packages/board/src/server/fleet.ts`, near `hasMergedPr`) has no arm for a claim-only branch, so it falls through to the commits-and-no-PR wording. `/plot-reconcile` section 3 ("Claims") already tells the two apart.

## Design

### Approach

Slice 1, the episode. When the repair record moves to `done` with attempt outcome `ended`, fleetd releases the attempt's branch the way `plot-dispatch.sh --release <branch>` does for a claim-only branch. It reuses that release path through the existing adapter and writes no second delete rule. A branch that carries a commit beyond the claim is left alone and reported, because the release refuses work.

Slice 2, the board. A branch whose commits beyond the default branch are all empty `plot: claim` markers reads `claim only` in the Quiet section and offers the release as its action. The decision lives in the domain, beside `claim-only-slice.ts`, as a property a unit test asserts; the component only renders it (CLAUDE.md, *Every rendered state is a domain property*). The `/plot-reconcile` section 3 test for "claim-only" is the reference answer, so the pair joins the corpus tier if the two implementations differ.

The release action goes through a controller, not a script call (CLAUDE.md, *The Master Agent Uses The Controllers*). The first task of slice 2 is to find the existing `release-claim` endpoint (`plot-ask.mjs release-claim`) and reuse it.

### Open Questions

- [ ] Does the episode release run in fleetd's tick, or where the record is written `done`? The second keeps one writer.
- [ ] Does a claim-only branch with an open desk and a live loop read as a claim, or stay out of the new reading until the loop ends?

## Slices

### Episode

- `bug/an-ended-repair-episode-releases-its-claim` — release the attempt's claim ref and desk when an episode ends with outcome `ended`

### Board

- `bug/the-board-names-a-claim-only-branch` — read an all-claim branch as a claim in Quiet, with the release as its action

## Notes

Raised from issue #3235. The plan writes nothing to the tracker.
