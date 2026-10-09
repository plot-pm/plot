# A merged PR's checks freeze at pending and the board shows CI running

> A merged slice shows no CI state, and the PR index asks the host once more for a merged row whose stored checks are `pending`.

## Status

- **State:** Approved
- **Type:** bug
- **Issue:** #1418
- **Sprint:** the-release-train-fixes-what-it-found
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-10-09, jwloka, in-session
- **Started:** 2026-10-09, jwloka, `feature/a-merged-pr-shows-no-ci-state`
- **Started:** 2026-10-09, jwloka, `feature/a-merged-pending-check-is-asked-again`

## Changelog

- A slice whose PR merged no longer shows "CI running", and neither does its plan row. A merged PR's checks decide nothing after the merge.
- The board asks the host once more for a merged PR whose stored checks are still `pending`, so the PR index holds the final check state for every reader.

<!-- Board impact: yes. The slice row and the plan row stop rendering a CI state for a merged PR, and the decision moves from packages/board/src/server/fleet.ts (`prStates`) into packages/domain. The delta PR refresh in fleet.ts gains a re-ask for merged rows with pending checks. No change to the plan format, the plan template, the helper scripts or the docs/plans layout. -->

## Motivation

The board shows "CI running" on merged PR #1413 (`feature/the-fleet-bundles-import-no-board`), on its slice row and on its plan row (operator screenshot, 2026-10-09). GitHub reports both checks green: `corpus=SUCCESS`, `validate=SUCCESS`. The PR merged at 06:35:04 UTC while its last CI run, started 06:34:27, was still running.

**The stored row is the cause.** `.git/.plot/state/index/github.json` (v3) holds `"state":"MERGED","checks":"pending"` for #1413, `updatedAt` 06:35:06. Measured again 2026-10-09 on the same store, merged rows by `checks`:

| `checks` | merged rows |
|---|---|
| unknown | 873 |
| green | 97 |
| none | 5 |
| **pending** | **5** — #1228, #1299, #1302, #1346, #1413 |
| failing | 2 |

**Two defects combine, and each one alone produces the symptom.**

- **The re-ask skips merged rows by design.** The delta refresh from #1364 (`fleet.ts:3237`) asks again only for `pendingOpenPrNumbers(stored)` (`packages/domain/src/rules/pr-index.ts:292`), whose TSDoc says *"A stored `pending` on a merged or closed row is left exactly as held."* That rule is right about the PR's `state` — a `MERGED` row cannot revert — and wrong about its `checks`, which were not terminal when the row was written. The re-ask question is also `pr-list --rich --state open`, so a merged PR cannot appear in its answer.
- **The render reads a merged PR's checks.** `prStates` (`fleet.ts:6184`) gives `CLOSED` its own word ahead of every check, and states that `merged` gets no word because *"a merged PR's row is already `merged` via the branch state"*. A merged PR's `mergeable` is not `mergeable`, so the next arm answers `['pending']` from its checks. The client prints that as "CI running" (`tuple-row.ts:398`, `host-notes.ts:511`).

`CLAUDE.md` (*The Layering Rule*) requires every rendered state to be a domain property. `prStates` sits in `fleet.ts`, and no unit test states what a merged PR renders.

## Design

### Approach

**Slice 1 — a merged slice shows no CI state.** A domain rule answers that a `MERGED` PR has no check state to report, beside `prRowPlacement` in `packages/domain/src/rules/pr-row.ts`. `prStates` calls it before it reads `mergeable` or `checks`, the way it handles `CLOSED` today. The plan row's aggregate reads the same answer, so a plan whose only pending PR has merged stops reading "CI running". A unit test asserts the rule for every `checks` value on a `MERGED` record, and one assertion proves the plan row's aggregate follows it.

This slice fixes the screen alone. It does not change the store.

**Slice 2 — the index asks once more for a merged row with pending checks.** A domain rule beside `pendingOpenPrNumbers` names the `MERGED` rows whose stored `checks` is `pending`. The delta refresh in `fleet.ts` asks the host for them, folds the answer through the existing path, and writes the store. `fleet.ts` stays the only caller of `foldPrIndex` (*A Decision Reads The Index*, one writer).

The re-ask cannot reuse the open question: `pr-list --rich --state open` never returns a merged PR. `plot-host.sh pr-list` takes `--state merged` and `--rich`, and takes no number filter (answered in `2026-10-07-the-board-reads-a-pr-while-its-ci-runs`). The cheapest question that reaches a recently merged PR is `pr-list --rich --state merged --limit <n>`, because GitHub lists by number descending and a PR that merged mid-run is recent.

The re-ask is bounded the same way the open re-ask is: `PR_PENDING_REASK_LIMIT` (`fleet.ts:279`) consecutive no-progress answers per number. A merged PR whose last run was cancelled can stay `pending` on the host, and must not cost one request per delta forever.

### What this does not do

- It does not re-ask a `CLOSED` row. Slice 1's rule and `prStates` already render a closed PR as `closed`, whatever its checks say.
- It does not touch the 873 merged rows stored as `unknown`. A merged row's `unknown` is what `--rich-open` stores for a terminal row, and nothing renders it once slice 1 lands.
- It does not narrow or widen the full read.

### Open Questions

- [ ] **Does slice 2 earn its request once slice 1 lands?** After slice 1, nothing on the board renders a merged PR's checks. The issue asks for slice 2 so that *"the index holds the final answer for every other reader"*. A grep for readers of `checks` on a `MERGED` row answers this: if none exists, slice 2 buys correctness of a stored field nobody reads, and the plan can drop it.
- [ ] **Which question reaches the five rows today?** #1228 is about 190 PRs older than #1413. A `--state merged --limit` small enough to be cheap does not reach it. Either the limit covers the oldest pending number, or the five legacy rows are left as held and only rows written after the fix are asked. The answer decides `<n>` and the request cost.
- [ ] **Why did a full read not overwrite #1228?** The store says `pending` five weeks after the merge. Either the full read keeps a held merged row's checks, or it never re-reads merged rows richly. The answer decides whether slice 2 must also change the fold, or only the delta.

## Slices

### A merged slice shows no CI state

- `feature/a-merged-pr-shows-no-ci-state` — a domain rule answers no check state for a `MERGED` PR; `prStates` and the plan row's aggregate read it <!-- builds: the merged-PR arm of the PR row's check state, as a domain rule --> → #1423

### A merged pending check is re-asked

- `feature/a-merged-pending-check-is-asked-again` — the delta refresh asks the host for `MERGED` rows whose stored checks are `pending`, bounded by `PR_PENDING_REASK_LIMIT` <!-- builds: pendingMergedPrNumbers and its re-ask in the delta refresh -->

## Done when

Each test below fails on `origin/main` (`9a8be5b68`) today:

- The domain rule: a `MERGED` record with `checks` of `pending`, `green`, `failing`, `none` or `unknown` reports no check state. `prStates` on the same record agrees.
- The plan row: a plan whose only PR with `pending` checks has merged does not aggregate to "CI running".
- One browser test proves a merged slice row renders no "CI running".
- The delta refresh: a stored `MERGED` row with `pending` checks is asked again, and reads `green` after one refresh when the host answers `green`. A sixth no-progress answer asks nothing.
- `fleet.ts` remains the only caller of `foldPrIndex`.
- `node skills/plot/scripts/board/plot-local-checks.mjs` and the commands it prints pass on each branch.

## Notes

- Created unattended from issue #1418 on 2026-10-09. Type `feature` came from the request.
- `PLOT-UNASKED: Who reviews this, and where does the work happen? — default — in-session + own branches`, matching `2026-10-07-the-board-reads-a-pr-while-its-ci-runs`, whose two slices this plan amends: two independent slices, each with its own PR.
- `PLOT-UNASKED: Is this intentionally separate from a-merged-pr-is-not-asked-for-its-checks and the-board-reads-a-pr-while-its-ci-runs? — default — proceeded`. Both are Released. The first stops the scan asking a merged PR for its rollup; the second built the open-only re-ask in #1364 that this plan extends to merged rows.
- Deliverable search, 2026-10-09: `pendingMergedPrNumbers` and `mergedPrChecks` match nothing in the estate. `pendingOpenPrNumbers` (`pr-index.ts:292`) is the rule slice 2 sits beside, and `prRowPlacement` (`pr-row.ts`) is the rule slice 1 sits beside. Neither is replaced.
- Slice 1 comes first: it removes the symptom with no host request, and slice 2's first open question depends on it.
