# A slice nobody worked on reads not started

> The board has no reading for a slice with no work on it, so it guesses. On 2026-09-30 an empty claim sat in DONE as *merged*, a slice with no branch sat in WAITING ON YOU as *commits, no PR ever opened*, and a slice with a live agent sat in DONE because of a PR the agent had closed.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Issue:** #1090, #1091
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A claimed branch with no work of its own no longer reads as merged, a slice whose branch does not exist waits in NOT STARTED, and a slice with a live agent stays in WORKING whatever its PR history.

Board impact: yes. Rows move between sections; no payload field is added or removed.

## Motivation

Three rows measured 2026-09-30, all on the W40 sprint's Must, `every-temp-directory-has-an-owner` (#1083), or its neighbours:

| Slice | Board | Truth |
|---|---|---|
| `bug/the-suites-own-their-temp-root` | DONE, state `merged`, verdict `complete` | A ref pushed at the then-tip of `main`; main has moved on. No commit of its own, no PR. |
| `bug/every-state-file-declares-its-bound` | WAITING ON YOU, *commits, no PR ever opened, age unknown* | No ref on `origin`, none locally, none in any worktree; state `blocked`, brief missing. |
| `bug/a-state-sweep-is-one-request` (#1049) | DONE, *PR closed without merging*, green live marker | An agent resumed 40 min earlier and held two file-touching commits; it had opened #1089 from its claim commit and closed it 38 s later. |

A fourth, older case is #1090's own: `bug/the-board-runs-the-artifact-its-repo-built` (#1055) sat in DONE as *delivered / merged* for 20 h with 0 commits, no PR and its plan still `Approved`.

**`merged` is the worst of these.** It settles a wave (`branch-state.ts`, the zero-ahead arm's own comment), so a slice nobody wrote can open the next wave. On 2026-09-30 the only thing keeping slice 3 of #1083 from the queue was its missing brief.

## Design

### Slice 1: zero ahead and behind main is not landed work

`branchState` (`packages/domain/src/rules/branch-state.ts`) ends its zero-ahead arm with `return 'merged'` for any ref strictly behind the default branch. The arm's own table names three shapes behind that answer — landed work, a lost claim, a branch cut from an older main — and only the first is merged. Its comment says the unresolved case is what `unknown` states; the code returns `merged`.

The rule: a ref with zero commits ahead that is strictly behind the default branch reads `merged` only on positive evidence — `mergeSubjectFound`, or `pr === 'MERGED'`. With the host asked and answering no merged PR, it reads `open`: it holds nothing, the same answer the equal-tips case already gives. With the host unreachable (`hostReach` of `throttled`, `secondary` or `failed`), it reads `unknown`, which holds its wave. This is the no-ref arm's rule, *positive evidence only*, applied to the zero-ahead arm.

`packages/domain/corpus/branch-state.corpus.test.ts` compares the rule with `board/plot-branch-state.mjs`. The corpus gains the three shapes; on a disagreement the branch stops, per *A Shell Script Asks The Domain*.

### Slice 2: a slice with no work waits in NOT STARTED, and a live agent keeps WORKING

**No branch.** `classifyGroup` (`packages/board/src/server/fleet.ts:4073`) has arms for `deferred`, `open`, `claimed` and `merged`; every other state falls to the tail commented `// state === 'wip'`, which builds `wipReadings` and asks `quietNote`. A `blocked` or `waiting` slice with no ref reaches that tail and reads `abandoned`, *commits, no PR ever opened*, in WAITING ON YOU. The tail is guarded on `state === 'wip'`; every other state without a ref goes to NOT STARTED with the note its verdict already has (`BLOCKED_NOTE`, or the waiting sentence), the same arms `state === 'open'` uses (`:4733`, `:4752`).

**A live agent.** `rowsFromPulse` sets `group = closedPr ? 'done' : openGroup` (`fleet.ts:6542-6547`) without reading the worker. A closed PR is terminal for the PR, not for the branch: while `worker` is `running` or `waiting`, the row stays in WORKING and the note keeps *PR closed without merging* as a second fact. `quietKind`'s `closed-pr` describes a branch *nobody is on*, and this row has somebody on it.

### What this does NOT do

- **It does not fix the queue.** The supervisor's queue ignores `waits:` (#1100) and hands out a slice whose ref exists; both stay filed.
- **It does not change `/plot-implement`.** An empty claimed branch with no worker (#1090's first half) is still created; this plan only stops it reading as merged.
- **It does not relabel free desks.** Two desks on this machine run a loop with no manifest and are labelled by the branch they have checked out; that is a separate defect with its own ticket.

## Done when

- `branchState` answers `open` for a ref strictly behind main with zero commits ahead and the host asked with no merged PR, `unknown` for the same ref with the host throttled, and `merged` with `pr === 'MERGED'` or a merge subject; `branch-state.test.ts` holds all three, and the corpus agrees.
- A plan whose second slice is such a ref does not complete that slice's wave, asserted through the scan's verdict for the next slice.
- A `blocked` slice with no ref classifies to `not-started` with `BLOCKED_NOTE`, never *commits, no PR ever opened*; a `wip` slice with real commits, no PR and no worker still reads `abandoned`.
- A row with a closed PR and `worker` `running` or `waiting` classifies to `working`; with no live worker it stays in DONE as today.
- The three measured rows above, rebuilt as fixtures, land in NOT STARTED, NOT STARTED and WORKING.

## Slices

### Zero ahead is not merged (Branch: bug/zero-ahead-is-not-merged)

`branchState`'s zero-ahead arm answers `merged` only on positive evidence, with the corpus extended.

### A slice with no work waits in not started (Branch: bug/a-slice-with-no-work-waits-in-not-started)

`classifyGroup`'s tail guarded on `wip`, and `rowsFromPulse`'s closed-PR arm yielding to a live worker.

## Notes

**Found while recovering the fleet on 2026-09-30.** One of the three rows was made by the operator's own recovery: an empty claim pushed at `origin/main` to keep the queue from handing out slice 2 of #1083 early (#1100), which then read as merged.
