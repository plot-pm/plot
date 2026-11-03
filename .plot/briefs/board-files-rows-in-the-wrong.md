## Implementation brief — board-files-rows-in-the-wrong (wave 1: Quiet placement)

- **Plan (canonical):** `docs/plans/2026-11-03-board-files-rows-in-the-wrong.md` on main
- **Approved:** 2026-11-04, Jan Wloka, plan-PR #3098 merged
- **Branch:** `feature/board-files-rows-in-the-wrong` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review App; one full review per PR)

Wave 2 (`feature/working-shows-claims-without-a-worker`) waits on this branch. It builds on this branch's `stateStatus` order, `startableNote` rule and `withHandOver` kind clearing, so land them as the plan states them.

### What to build

The board files `abandoned` and `orphaned-claim` rows under WAITING ON YOU. Operator decision B (2026-11-03) moves them to QUIET, keeping their Open menu item, their kind word and their note. `quietPlacement` (`packages/domain/src/rules/quiet.ts:196-208`) answers `quiet` for both kinds, and its return type becomes `'done' | 'quiet'`. The plan is canonical; this brief is orientation.

The change touches six places beyond `quietPlacement`:

- Delete `quietNeedsPerson` (`quiet.ts:219-220`), its tests (`packages/domain/test/quiet.test.ts:142`, `:176-204`) and the five comments naming it (`fleet.ts:4738`, `:6452`, `:7249`, `:7284`; `a-landed-branch-leaves-waiting.test.ts:90`). They name `quietPlacement` afterwards.
- The orphaned-claim arm (`fleet.ts:4757-4767`) takes its group from `quietPlacement(claimedReadings(…))`, not a literal.
- `withHandOver` (`fleet.ts:6022`) reads an orphaned claim as `state === 'claimed'`, `group === 'quiet'`, `pr === null`. Both of its rewrites set `quietKind: null` beside `startability: 'someone-is-on-it'`. Fix the TSDoc at `fleet.ts:6001-6002` and `:6010`.
- `offersOpen` (`menus.tsx:120-122`) answers true for a `quiet` row with `quietKind` `abandoned` or `orphaned-claim`; its `Pick` gains `'quietKind'`. Fix the comment at `menus.tsx:642-647`.
- `stateStatus` (`tuple-row.ts:1160-1181`) gains one check before the `startability` check: `group === 'quiet'` and `quietKind` set returns `quietKindWord(quietKind)`. Rewrite the comment at `tuple-row.ts:1175-1180`.
- `startableNote` (`rows.tsx:1597-1599`) keeps the note where `group === 'quiet'` and `quietKind` is set, and blanks it for every other `someone-is-on-it` row.

### Decisions the plan settles — do not re-derive them

- **The `group === 'quiet'` condition on the `stateStatus` check is required.** `rowQuietKind` also gives a kind to rows outside QUIET that read `someone is on it` on purpose: a fresh claim or fresh `wip` branch of a Draft or Design plan (`draftPlacement`, `fleet.ts:4717-4722`, `4839-4844`) and a `claimed` branch with an open PR (`fleet.ts:4267`). Without the condition, a branch claimed 2 minutes ago reads `unclaimed`. The plan's guard tests fail if you drop it.
- **Plan-named rows read `someone is on it` on origin/main** because `startabilityVerdict` answers that for every `claimed` and `wip` branch (`verdict.ts:56`) and `stateStatus` reads `startability` first. Do not change `startabilityVerdict`; `auto-dispatch.ts:656` and `sliceHold` read it.
- **Placement reverses two settled rules**: #362 (slice Inverted, `ce27834f9`) for wave 2 only, and #1758/#1902 (`53a010f69`) for this wave. A test or comment stating the old placement is updated, not repaired as a defect.
- **The reporter gap is accepted.** A plan-named abandoned branch leaves the action list; QUIET shows it with the word `abandoned`.
- **Do not touch** `deriveSlices`, `startabilityVerdict`, the `abandoned` attention verdict (`attention.ts:236`, `:249`) or the `GROUPS` hints in `sections.ts`.
- Carried over: absent is not false. A missing `quietKind` is `null`, never a kind word.
- Domain code is written as arrow functions, in `packages/domain` and in anything you write or rewrite elsewhere. The domain imports `zod` and nothing else outside `adapters/`.

### Done when

The plan's `## Done when` list is the specification; this slice's tests are in its `### Tests` > Slice 1 list. Lift these assertions, because a naive implementation passes without them:

- The typed invariant in `classifier-is-total.test.ts` over `withHandOver(rowsFromPulse(…), agents)`: no row with `pr === null` and `quietKind` `abandoned` or `orphaned-claim` sits in `waiting-on-you`, except a `draft` plan's `claimed` or `wip` row with a fresh tip or local activity. The test decides the exception from fixture inputs, never from the row's note. It catches the stale `wip` and stale claim fixtures on main.
- The `stateStatus` guards (Draft-plan fresh claim, fresh `wip`, double hand-out, `quietKind: null`). They pass on main and fail if the `group === 'quiet'` condition is dropped.
- The `quietKind: null` assertions on handed rows. They fail on main, which keeps the kind.
- `startableNote` keeps the abandoned row's note in QUIET (main shows none).
- The mock row: add an `abandoned` row to `packages/board/src/server/mock-fleet.ts`.
- Flip every assertion the plan lists from `waiting-on-you` to `quiet` (quiet.test, a-quiet-row-lands-in-quiet, a-landed-branch-leaves-waiting, an-idle-branch-says-how-long, branch-with-work-is-seen, classifier-is-total, fleet.test, a-handed-slice-reads-as-taken, and the two browser tests).
- Update the QUIET table in `docs/board-domain-model.md:1091-1106`: branch state admits `claimed`, and a PR may be absent.

Plus: add one changeset for `'@plot-pm/board': patch` and `'plot': patch` with the description first and the `plan:` comment block after it; run `./scripts/check-changeset-packages.sh`. Do not commit the rebuilt board artifact (`pnpm build:board` only to test, then restore the generated paths). Before each push run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. The `CI suites` run in CI; a failure there comes back as a correction. Do not run `test:e2e` locally. This slice touches no `.sh` file; if it does, `scripts/check-shell-lines.sh` refuses growth, so remove shell elsewhere or write the rule in the domain.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line under `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/quiet.ts`, `packages/domain/test/quiet.test.ts`, the `withHandOver`, orphaned-claim and comment edits in `packages/board/src/server/fleet.ts`, `menus.tsx`, `tuple-row.ts`, `rows.tsx`, `mock-fleet.ts`, the listed board tests, `docs/board-domain-model.md` (QUIET table only) and one changeset. Wave 2 (`feature/working-shows-claims-without-a-worker`) owns `unworked-branch.ts`, the `no-known-worker` startability, the four claimed and `wip` arms of `classifyGroup`, `claimedWithoutWorkerRows`, `sectionCount` and the WORKING and NOT STARTED doc tables; do not start them here.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
