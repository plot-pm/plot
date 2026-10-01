# A closed PR carries no branch

> `plot-open-pr.sh` refuses a branch that a closed, unmerged PR once carried. That PR delivered nothing, so the refusal leaves a finished slice with no way to open the PR its plan requires.

## Status

- **State:** Approved
- **Approved:** 2026-10-02, jwloka, in-session
- **Type:** bug
- **Sprint:** the-fleet-runs-through-its-limits
- **Issue:** #1093
- **Review:** in-session
- **Impl:** own branches

## Changelog

- `plot-open-pr.sh` opens a PR for a branch whose only earlier PR was closed unmerged, and names that closed PR in its output and in the new PR's body. It still refuses a branch that an open or merged PR carries.

## Motivation

#1093, measured 2026-09-30 on `bug/a-state-sweep-is-one-request` (#1049): the agent opened #1089, titled from its claim commit, and closed it 38 s later. The branch was force-pushed after that, so GitHub refuses to reopen #1089. From then on `plot-open-pr.sh` refused the branch because #1089 *already carries* it. The agent stopped with `PLOT-BLOCKED`, holding two finished commits.

**Where the closed PR becomes a carrier.** Measured on `origin/main` (`4fe88a8d`), 2026-10-01:

- `plot-open-pr.sh:138-155` asks `plot-host.sh pr-list --state all --limit 200` and keeps the number of the **first** row whose `head` is the branch (`:149`). It reads no `state`, although every row carries one: `plot-host.sh:3906` (GitHub, `state:.state`) and `plot-host.sh:4019` (Bitbucket, `DECLINED` mapped to `CLOSED`).
- The script hands that one number to the rule as `existingPr` (`plot-open-pr.sh:204`, `:216`), and `entry/slice-pr.ts:101` reads it with `numberOr`.
- `openSlicePr` refuses on any `existingPr > 0` with `pr-exists` (`packages/domain/src/rules/slice-pr.ts:210-216`). Its own type comment says the refusal is for *"an open or merged PR"* (`slice-pr.ts:34`), and the script's comment says the same (`plot-open-pr.sh:133-135`). The code does not do what both comments say.
- The tests pin only the two cases the comments name: an `OPEN` row (`test/reconcile/openpr.test.mjs:275`) and a `MERGED` row (`:284`). No test has a `CLOSED` row.

**A second shape of the same defect.** The script keeps the first matching row only. A branch with a closed PR and a later open PR gives an answer that depends on the host's row order: the refusal names whichever row comes first. The rule must see every row for the branch.

**What is not this plan.** #1091 (the same closed PR placed the live slice in DONE) is closed. The board's reading of a closed PR is not changed here.

## Design

### Approach

**The rule decides which PR carries the branch.** `SlicePrReadings.existingPr: number` becomes `prs: readonly SlicePrRow[]`, where `SlicePrRow` is `{ number, state }` and `state` is `'OPEN' | 'MERGED' | 'CLOSED'`. The adapter passes every `pr-list` row whose `head` is the branch, in the host's order, and decides nothing.

`openSlicePr` then:

| Rows for the branch | Answer |
|---|---|
| none | decides (unchanged) |
| at least one `OPEN` or `MERGED` | `pr-exists`, naming the first such row, whatever its position |
| only `CLOSED` | decides, and `closedPrs` names each closed number |

`SlicePrDecision` gains `closedPrs: readonly number[]`. `bodyFor` adds one line where it is not empty: *"Earlier PR #1089 was closed unmerged."* The refusal order stays: plan, wave, PR, commits (`slice-pr.test.ts:133`).

**An unknown state counts as carrying.** A row whose state the entry cannot read becomes `OPEN`, so a value the rule does not recognise refuses, as today. The opposite direction would open a duplicate PR on a parse defect, and the host does not always refuse a duplicate on Bitbucket.

**The host that cannot be asked stays as today.** A failed `pr-list` gives no rows (`plot-open-pr.sh:139`), and the rule opens; the comment at `:136-137` states why. This plan does not change that.

**The adapter.** `plot-open-pr.sh:141-153` prints a JSON array of `{number, state}` for every matching row instead of one number, and the request carries it as `readings.prs`. `entry/slice-pr.ts` reads the array with a `prsFrom` reader beside `numberOr`. Where the decision names closed PRs, the script prints `plot-open-pr: '<branch>' had #1089 closed unmerged — opening a new PR` to stderr, the way it prints the marker-only notice (`plot-open-pr.sh:248-250`). The bundle `skills/plot/scripts/board/plot-slice-pr.mjs` is rebuilt (`packages/board/build.mjs:721-725`).

No new script, no new host call: the one `pr-list` call already returns the state.

### Open Points

- [ ] `pr-list --limit 200` is a window. A branch whose open PR is older than the 200 newest rows reads as having none, and the script opens a duplicate. That is true today for every state and is not changed here.

## Slices

### A closed PR carries no branch (Branch: bug/a-closed-pr-carries-no-branch)

- `bug/a-closed-pr-carries-no-branch` — `SlicePrRow`, `prs` and `closedPrs` in `packages/domain/src/rules/slice-pr.ts`; `prsFrom` in `packages/board/src/server/entry/slice-pr.ts`; the row array in `skills/plot/scripts/plot-open-pr.sh`; the rebuilt bundle; a changeset for `plot` and `@plot-pm/board`. <!-- builds: openSlicePr reads every PR row of a branch -->

## Done when

Each test below fails on `origin/main` today:

- `packages/domain/test/slice-pr.test.ts`: a branch whose only row is `CLOSED` decides, and the decision carries `closedPrs: [1089]`; the body names `#1089` as closed unmerged; rows `[CLOSED 1089, OPEN 1102]` and `[OPEN 1102, CLOSED 1089]` both refuse with `pr-exists` naming `#1102`; a `MERGED` row behind a `CLOSED` row refuses naming the merged number. The existing `OPEN` and `MERGED` cases move to `prs` and still refuse. 100 % branch coverage holds for `slice-pr.ts`.
- `packages/board` unit test for `readingsFrom`: an absent `prs` reads as no rows; a row with an unknown or missing state reads as `OPEN`; a row with no number is dropped.
- `test/reconcile/openpr.test.mjs`: with `{ number: 1089, state: 'CLOSED', head: 'feature/alpha' }` the script opens a PR, and stderr names `#1089`; with a `CLOSED` row listed before an `OPEN` row for the same head the script refuses naming the open number. The existing tests at `:275` and `:284` pass unchanged.
- `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board`, `pnpm run typecheck` and the domain coverage gate pass.

## Notes

#1093 and #1094 were filed together and share no mechanism. #1093 is about which PR row carries a branch when a slice's PR is opened (`slice-pr.ts`). #1094 is about the label the supervisor gives a slice when the merged listing cannot be asked (`queue.ts`), and `a-hold-names-the-landing-nobody-could-answer` already plans it, beside `a-merge-subject-proves-a-landing-the-host-cannot` (#1139) and `the-queue-reads-the-order-the-scan-reads` (#1100). So this plan answers #1093 only.
