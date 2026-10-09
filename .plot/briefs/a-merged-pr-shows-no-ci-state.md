## Implementation brief — a-merged-pr-s-checks-freeze (wave 1: A merged slice shows no CI state)

- **Plan (canonical):** docs/plans/2026-10-09-a-merged-pr-s-checks-freeze.md on main
- **Approved:** 2026-10-09, jwloka, in-session
- **Branch:** `feature/a-merged-pr-shows-no-ci-state` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** per repo convention (PR review, CI)

Wave 2 (`feature/a-merged-pending-check-is-asked-again`) waits on this branch. This branch waits on nothing.

### What to build

The board shows "CI running" on merged PR #1413, on its slice row and on its plan row, while GitHub reports both checks green. The PR merged at 06:35:04 UTC while its last run was still going, and the store holds `"state":"MERGED","checks":"pending"`. The render reads that stored word.

Add a domain rule beside `prRowPlacement` in `packages/domain/src/rules/pr-row.ts`: a `MERGED` PR reports no check state, whatever its `checks` value. Then make both render paths in `packages/board/src/server/fleet.ts` ask it first:

- `prStates` (`fleet.ts:6184`) answers for `CLOSED` before it reads `mergeable` or `checks`. A merged PR needs the same early exit. Its comment says `merged` gets no word because the branch state already says `merged`; keep that, and return the answer the rule names.
- The three `prRowPlacement` call sites (`fleet.ts:4597`, `5114`, `6087`) feed the plan row's aggregate and the note. A merged PR must not reach `CI running` there either. Read each site and decide from the code which one the plan row uses; do not assume.

This slice fixes the screen only. It does not change the store, and it does not ask the host anything.

### Settled decisions — do not re-derive them

- **The store is not the fix here.** The 5 merged rows with `pending` checks (#1228, #1299, #1302, #1346, #1413) are slice 2's subject. 873 merged rows store `unknown` and 97 store `green`; the rule must answer the same for all five `checks` values, so the render never depends on what the store happens to hold.
- **`pendingOpenPrNumbers` is right about `state` and wrong about `checks`.** Do not touch `pr-index.ts` in this slice. Its TSDoc ("A stored `pending` on a merged or closed row is left exactly as held") is slice 2's to amend.
- **The rule goes in the domain, not in `fleet.ts`.** `CLAUDE.md` (*The Layering Rule*): every rendered state is a domain property. `packages/domain` takes arrow functions (`export const f = (…) => …`), and a TSDoc block states what the export returns and how it fails, with no history. The reasoning goes in the commit message.
- **`CLOSED` stays as it is.** `prStates` already answers `['closed']` for it. Do not merge the two arms into one.
- **Vocabulary:** the slice is a Slice, not a Wave, in any new identifier. The code still says `Wave` in places; add none.
- **The index never says no.** Nothing in this slice writes or reads the store differently. `fleet.ts` stays the only caller of `foldPrIndex`.

### Done when

The plan's `## Done when` list is the specification. The tests that matter, and what each catches:

- The domain rule returns no check state for a `MERGED` record with each of `pending`, `green`, `failing`, `none`, `unknown`. A test over one value passes with a rule that special-cases `pending`; the loop over all five catches it.
- `prStates` on the same record agrees with the rule. This catches a rule that exists and is never called.
- The plan row: a plan whose only PR with `pending` checks has merged does not aggregate to "CI running". This catches a fix applied to `prStates` alone, which leaves the plan row reading the old path.
- One browser test proves a merged slice row renders no "CI running". Use a record with `checks: 'pending'`, not `unknown`, or the test passes on `origin/main`. Prove the test fails on a pristine `main` worktree before you rely on it.

Each test must fail on `origin/main` (`9a8be5b68` per the plan) today. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` does not apply. Add a changeset (`'plot': patch`, description first, `bumps:` block last, optional `plan:` line). Do not edit versions by hand, and do not commit a rebuilt `board-server.mjs`.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/pr-row.ts`, its test `packages/domain/test/pr-row.test.ts`, the `prStates` and `prRowPlacement` call sites in `packages/board/src/server/fleet.ts`, the board unit test that covers them (`packages/board/test/unit/fleet.test.ts`), one browser test, and a changeset.

Wave 2 owns `packages/domain/src/rules/pr-index.ts` and the delta refresh in `fleet.ts` (near `PR_PENDING_REASK_LIMIT`, line 279, and line 3247). Stay out of both. If you find something the plan did not anticipate, report it rather than improvising outside scope.
