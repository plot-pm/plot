# The board reads a PR while its CI runs

> A PR whose CI runs reads as waiting on a machine, a check that finished reads as finished within one refresh, and a branch pushed after the last PR fetch reads its PR as unknown, not as never opened. The decision moves into the domain.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** the-release-train-fixes-what-it-found
- **Issue:** #1164, #1277, #1240
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-10-07, jwloka, in-session
- **Started:** 2026-10-07, Jan Wloka, `bug/a-pending-check-outranks-mergeability`

## Changelog

- A PR with running checks is listed in WAITING ON A MACHINE while GitHub recomputes its mergeability. A PR with a conflict stays in WAITING ON YOU, whatever its checks say.
- The board asks again for every open PR whose stored checks are `pending`, so a green PR no longer reads "CI running" until the next full read.
- A branch whose last commit is newer than the last PR fetch reads its PR as unknown, and does not read "commits, no PR ever opened" until a newer fetch lands.

<!-- Board impact: the WAITING ON YOU / WAITING ON A MACHINE placement of PR rows changes, and the decision moves from packages/board/src/server/fleet.ts into packages/domain. The delta PR refresh asks for pending PRs by number. No change to the plan format, the plan template or the docs/plans layout. -->

## Motivation

The board places a PR row in WAITING ON YOU or WAITING ON A MACHINE in `classifyGroup` (`packages/board/src/server/fleet.ts:4479`). Three defects in that path send an operator to the wrong place:

- **Running CI reads as waiting on a person (#1164).** `fleet.ts:4978` returns `waiting-on-you` for any `pr.mergeable !== 'mergeable'` before the `checks: 'pending'` arm at `:4987`. GitHub answers `UNKNOWN` while it recomputes mergeability after every push, which is when CI starts. Observed 2026-10-02 on #1157 and #1159.
- **A finished check stays pending for up to 24 hours (#1277).** The delta refresh asks only `--since` (`fleet.ts:3091-3093`). A check run that completes does not change a PR's `updatedAt`, so the delta never returns it, and the stored `pending` stays until the next full read (`PR_FULL_READ_MS`, `fleet.ts:316`). Measured 2026-10-05 on #1271: green at 07:08Z, "CI running" at 07:31Z.
- **A new branch reads as abandoned (#1240).** `claimedReadings` and `wipReadings` (`fleet.ts:5610-5640`) read a missing PR as `none` when the branch was pushed after the last PR fetch. Measured 2026-10-03: `infra/agents-md-mirrors-claude-md` read "commits, no PR ever opened" for about 8 minutes while #1239 was open.

`CLAUDE.md` (*The Layering Rule*) requires every rendered state to be a domain property. All three decisions live in `fleet.ts` today, and the only test of the order is a rendered board.

## Design

### Approach

**One domain rule places a PR row.** `prRowPlacement(readings)` in `packages/domain/src/rules/pr-row.ts` takes the PR's `mergeable` and `checks` and answers the group and the note. The order is:

| `mergeable` | `checks` | Group | Note |
|---|---|---|---|
| `conflicting` | any | waiting on you | cannot say whether it merges (unchanged) |
| `unknown` or absent | `pending` | waiting on a machine | CI running |
| `unknown` or absent | any other | waiting on you | cannot say whether it merges (unchanged) |
| `mergeable` | `pending` | waiting on a machine | CI running (unchanged) |
| `mergeable` | `failing`, `none`, `unknown`, `green` | waiting on you | as today: checks failing, no checks, cannot read the checks, green |

Only the second row changes behaviour. A green draft PR keeps the fall-through it has today (`fleet.ts:5001`).

`classifyGroup` and `prState` both call the rule, so the row's word and its sentence cannot disagree. A unit test asserts each row of the table without a browser.

**The delta refresh asks for pending checks again.** Each delta refresh also asks the host for the open PRs whose stored checks are `pending`, by number. The PR store keeps a `pending` check as a non-terminal answer, as *A Decision Reads The Index* requires, so a re-ask is the only way it becomes terminal. The extra numbers go into the same `pr-list` question where the adapter allows it, and `PR_REQUESTS_PER_REFRESH` counts any second question.

**A PR reading older than the branch reads unknown.** The quiet-branch readings take the time of the last PR fetch and the branch's last commit time. Where the commit is newer, `prState` is `unknown`, as it is for `hostUnasked` today. The decision moves into `packages/domain/src/rules/quiet.ts`, beside the two refusals of `abandoned` that already exist there for `hostUnasked` and `hasMergedPr`.

### Open Questions

- [ ] Slice 2: does GitHub's `pr-list` accept a set of numbers in one search, or does the adapter need one `pr-view` per pending PR? The answer decides the request cost.

## Slices

### A pending check outranks mergeability

- `bug/a-pending-check-outranks-mergeability` — `prRowPlacement` in the domain; `classifyGroup` and `prState` call it <!-- builds: prRowPlacement, the PR row's group as a domain rule --> → #1352

### Pending checks are asked again

- `bug/a-pending-check-is-asked-again` — the delta refresh asks for open PRs with pending checks by number <!-- builds: the pending-check re-ask in the delta refresh -->

### A branch newer than the PR fetch

- `bug/a-pr-fetch-older-than-the-branch-reads-unknown` — the quiet-branch readings compare the PR fetch time with the branch's last commit <!-- builds: the PR-fetch age reading in rules/quiet.ts -->

## Done when

Each test below fails on `origin/main` (`a778bda0d`) today:

- `prRowPlacement`: `unknown` with `pending` answers waiting on a machine; `conflicting` with `pending` answers waiting on you; `unknown` with `green` answers waiting on you. `classifyGroup` and `prState` agree on every row of the table.
- The delta refresh: a stored PR with `pending` checks and an unchanged `updatedAt` is asked again, and its checks read `green` after one refresh.
- The quiet-branch rule: a branch whose last commit is newer than the PR fetch reads `prState: unknown` and no `abandoned` note; the same branch after a newer fetch with no PR reads `abandoned`.
- One browser test proves a PR row with running checks renders in WAITING ON A MACHINE.
- `node skills/plot/scripts/board/plot-local-checks.mjs` and the commands it prints pass on each branch.

## Notes

- 2026-10-07, direction from jwloka: the PR-row decision moves into the domain, with one slice per issue; Type bug; reviewed in-session; own branches.
- The slices run in heading order (`packages/domain/src/rules/eligible.ts:131-134`). Slice 1 comes first because slices 2 and 3 change readings that its rule consumes.
- Deliverable search, 2026-10-07:
  - Slice 1: `classifyGroup` (`fleet.ts:4479`) holds the order today and is the code this slice moves; no `prRowPlacement` or equivalent rule exists in `packages/domain/src/rules/`.
  - Slice 2: no pending-check re-ask exists; the `--since` window is built at `fleet.ts:3091-3093`.
  - Slice 3: `hostUnasked` (`fleet.ts:4760`, `:5446`, `:5560-5564`) is the existing refusal of `abandoned` that this slice extends; no PR-fetch age reading exists.
