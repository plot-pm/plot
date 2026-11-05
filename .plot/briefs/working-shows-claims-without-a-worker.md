## Implementation brief — board-files-rows-in-the-wrong (wave 2: Claims without a worker)

- **Plan (canonical):** `docs/plans/2026-11-03-board-files-rows-in-the-wrong.md` on main
- **Approved:** 2026-11-04, Jan Wloka, plan-PR #3098 merged
- **Branch:** `feature/working-shows-claims-without-a-worker` (base: `main`)
- **Ends as:** one PR to `main`, opened with `plot-open-pr.sh`
- **Review of the code:** pull request review, as for every slice of this repo

This slice waits on `feature/board-files-rows-in-the-wrong` (slice 1, PR #3110). Slice 1 merged on 2026-11-05 at `37dbd5ead`, so this slice is eligible. Nothing waits on this slice.

### What to build

The board files a claimed or `wip` branch with no known worker under NOT STARTED, while its label says `someone is on it`. Measured 2026-11-03: `feature/mat-spiel-durchstich` is claimed on `origin`, a hand-started worker runs in its worktree, and WORKING lists nothing. The section reads the scan's worker reading (`classifyGroup`); the label reads `startabilityVerdict`, which answers `someone-is-on-it` for every `claimed` and `wip` branch and reads no worker. A hand-started worker writes no pid file and has no registry manifest, so `withHandOver` misses it too.

The fix is one function that decides section and label together. A new `packages/domain/src/rules/unworked-branch.ts` holds two arrows: `unworkedPlacement({ state, workerLive, fresh, local })` and `noteShown({ startability, group, quietKind })`. Four `classifyGroup` arms (fresh claim, claimed local activity, fresh `wip`, `wip` local activity) take group and startability from `unworkedPlacement`. `classify` passes the new optional `startability?: 'no-known-worker'` on, `rowsFromPulse` sets the row's `startability` from it on the plan-branch and ref-only paths, `withHandOver` widens its candidate test, and WORKING draws and counts the rows. The plan is canonical; its sections "Claims without a worker", "Tests" and "Docs" are the specification.

**Line numbers in the plan are stale.** The plan cites `origin/main` at `33403a3de`, before slice 1. Slice 1 moved every anchor in `fleet.ts`, `tuple-row.ts`, `rows.tsx` and `quiet.ts`. Find each by name (`classifyGroup`, `classify`, `withHandOver`, `localActivity`, `startableNote`, `rowStartability`, `NO_QUIET_WINDOW`), not by line.

### Settled decisions — do not re-derive them

- **`unworkedPlacement` is the only source of `no-known-worker`.** No second function derives the label from other readings. A row carries the label exactly where that function moved it. A second derivation is how the section and the label came to disagree.
- **`startabilityVerdict` does not change.** `auto-dispatch.ts` and `sliceHold` read it, and `sliceHold` reads only `!== null`. The row's `startability` is the `classify` answer's value when set and the final group is `working`, and `rowStartability` otherwise. A `declined` override sends a closed-PR row to `done`; it keeps `rowStartability`.
- **A stale claim or stale `wip` branch with no local activity never reaches `unworkedPlacement` with `fresh` or `local` true.** It stays in QUIET with `someone-is-on-it` and its `quietKind` word (slice 1, decision B). Giving it the new label is the defect the "label scope" fixture exists to catch.
- **A branch with an open PR never reaches `unworkedPlacement`.** The PR arm answers first. The draft-placement checks before the claimed and `wip` arms also answer first and do not change. `localActivity` keeps its notes and its `not-started` answer for the `open` arm.
- **The ref-only path keeps `startability: null`.** It passes `NO_QUIET_WINDOW` and `false, 0, …, false`, so `fresh` and `local` are false and the row lands in QUIET as `abandoned` at any age. Set its `startability` field from `startability ?? null` anyway, so both paths take the label from one function. Rewrite the comment that says the field is null "because the row is in NOT STARTED then": it is false on `main`.
- **`withHandOver` takes `group === 'working'` and `startability === 'no-known-worker'` as an additional candidate.** Not every `someone-is-on-it` row. A `wip` row with an open PR in WAITING ON YOU, and a stale abandoned row in QUIET, keep their group with one live session. Slice 1's rewrites already clear `quietKind`; widen only the candidate test.
- **The plan row (decision D) does not change.** `deriveSlices` keeps `complete ? 'done' : 'not-started'`: `sliceGroupsFor` reads `Slice.section` only as done or not done. A plan whose only row moves to WORKING loses its NOT STARTED head, and that is intended.
- **The count follows the drawn rows.** `sectionCount` adds the `no-known-worker` rows to `registry + planLevel.working`. A header that omits drawn rows breaks the count rule: a count beside a section is derivable from the section's rows (`sectionTally`).
- **Not live.** `isLive` answers false for a `no-known-worker` row (no pulse), and `showsWorkerLog` answers false (no process to log).
- **Rules carried over:** a row's section is decided on the server and tested through domain properties, not in a component. `noteShown` moves slice 1's `startableNote` rule into the domain unchanged. Absent is not false: `startability: null` on a ref-only row means the question does not apply.
- **Style:** every function you write is an arrow, in the domain and in tests. TSDoc states what the export does, not why; the reasoning belongs in the commit message.

### Done when

The plan's `## Slices` entry for this branch and its "Tests" section (Slice 2) are the specification. Assertions that exist because a naive implementation would pass without them:

- **Hand-over scope guards** (`a-handed-slice-reads-as-taken.test.ts`): an open-PR `wip` row and a stale abandoned `wip` row, each with one live session, keep their group. They pass on `main` and fail if the candidate test reads every `someone-is-on-it` row or drops the `group === 'working'` half.
- **Label scope:** a stale `wip` fixture reads `quiet`, `someone-is-on-it`, status word `abandoned`, never `no-known-worker`. It catches a rule that labels every unworked branch.
- **One-section test** (`every-row-lands-in-one-section.test.ts`, a new file): each row is selected by exactly one of `rowsBySection` plus the per-section filter, `workingAgentRows` and `claimedWithoutWorkerRows`. Include a ref-only `wip` branch no plan names with a 5-minute-old tip and no PR; it lands only in QUIET with `quietKind: 'abandoned'` and `startability: null`. It catches a row selected by none or two.
- **Startability invariant** (`classifier-is-total.test.ts`): no row with `someone-is-on-it` or `no-known-worker` has `group: 'not-started'`, over `withHandOver(rowsFromPulse(…), agents)`.
- **Case-1 fixtures:** `claimed`, age 5 minutes, `worker: 'none'`, no registry entry, Design plan with an approved spike; and an approved plan. Both read `working`, `no-known-worker`, note `claimed, no known worker`. Two live sessions read `waiting-on-you` and `handed to 2 agents at once`.
- **Domain coverage:** `packages/domain/test/unworked-branch.test.ts` covers every arm; the domain package holds 100% lines, branches, functions and statements.
- Flip the assertions the plan lists from `not-started` to `working`, including every other `classify('claimed' | 'wip', …)` case with a fresh age or local activity and no live worker, and the three fixtures in `claimed-slice-says-someone-is-on-it.browser.test.ts`. Add the mock-fleet row in `mock-fleet.ts`. Update the WORKING and NOT STARTED tables in `docs/board-domain-model.md` as the plan's "Docs" section words them.

Plus: add one changeset (description first, then the `plan:` comment block, packages `@plot-pm/board` and `plot`, patch; no `bumps:` block). Do not commit the board artifact; run `pnpm build:board` only to test. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run no full suite.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file; if it does, pay for the growth in the same change.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves); do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.

### Scope guard

This branch owns `packages/domain/src/rules/unworked-branch.ts` and its test, `rules/verdict.ts` (the enum value only), `packages/board/src/contract/schema.ts` (the enum value only), `packages/board/src/server/fleet.ts` (`classifyGroup`, `classify`, `withHandOver`, `rowsFromPulse` startability), `packages/board/src/server/mock-fleet.ts`, the board's `tuple-row.ts` (`startabilityWord`), `rows.tsx` (`startableNote` body), `working-agents.ts`, `plan-level-row.tsx` (`sectionCount`), `stuck.ts`, `menus.tsx` (`showsWorkerLog`), `AgentList.tsx`, the named tests, `docs/board-domain-model.md` and one changeset. No other branch of this plan is in flight; slice 1 is merged. Do not touch `attention.ts` (decision E), `deriveSlices`, `startabilityVerdict`'s body, or the `GROUPS` hints in `sections.ts`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
