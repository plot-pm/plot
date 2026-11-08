## Implementation brief — an-ended-main-repair-episode-leaves (wave 1: Episode)

- **Plan (canonical):** `docs/plans/2026-11-08-an-ended-main-repair-episode-leaves.md` on `main`
- **Approved:** 2026-11-08, Jan Wloka, plan-PR #3236 merged
- **Branch:** `bug/an-ended-repair-episode-releases-its-claim` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** `pr`, per the plan's `Review:` answer; issue #3235

The second slice, `bug/the-board-names-a-claim-only-branch`, is independent of this one. It reads a claim-only branch on the board and does not wait on this release.

### What to build

Three `bug/main-repair-<lastGreenSha>` branches stayed on origin after their episodes ended (issue #3235): `fcc797085ba9` (claimed 2026-11-03), `e54e5381561a` (2026-11-04) and `9c77fff4cc8e` (2026-11-06). Each held one commit, the empty `plot: claim …` marker. Main recovered by a rerun, so no repair agent committed. `.plot/state/repair-record.json` read `state: done` with `attempt: {branch: bug/main-repair-9c77fff4cc8e, outcome: ended}`. The refs stayed until a person ran `plot-dispatch.sh --release` on 2026-11-08.

The writer of `state: done` is `closePrs` in `packages/fleet/src/shared/revert-start.ts` (the `moved(world, record, 'done', {})` call near line 434). `repairStartTick` (`repair-start.ts`) records `outcome: 'ended'` and starts nothing; no step after either gives up the ref. Build the release at the `done` write:

1. Add a release port to `RevertWorld` (`revert-start.ts`), shaped like the fresh-agent step's `release: (branch, localEvidence?) => Promise<{released, detail}>`.
2. In `closePrs`, after `moved(..., 'done')` succeeds, release `record.attempt.branch` when the attempt exists, its `outcome` is `ended` and the branch matches `mainRepairBranchOf(record.lastGreenSha)`. A branch that carries a commit beyond the claim stays, and the tick reports it through `notify` or `warn`; the release refuses work by itself.
3. Wire the port in `revertWorldOf` (`revert-start-world.ts`) and in the `revertWorldOf({...})` call in `registryd-main.ts` (near line 3395). Reuse `releaseClaimOf` (`registryd-main.ts`, near line 2870), which calls `gatherReadingsAndRelease` with the `claim-only` local evidence. The adapter runs `plot-dispatch.sh --release`; write no second delete rule.

### Settled decisions — do not re-derive them

- **One writer owns the episode's end.** The release runs where the record is written `done`, not in a later tick that derives the ending again. Settled by jwloka, 2026-11-08. A separate sweep of `bug/main-repair-*` refs would be a second reader of the same fact, free to drift from the record.
- **Release through `releaseClaimOf`, never the script.** The controller decides `agent-live` and `pr-open` from readings and the script keeps four refusals of its own (live worker, file-changing remote commit, unpushed local commits or changes, `PLOT-BLOCKED` marker). Calling `plot-dispatch.sh --release` directly skips the domain's decision (CLAUDE.md, *The Master Agent Uses The Controllers*; `releaseClaim` in `dispatch-verbs.ts`).
- **`outcome: 'lost'` never releases.** A lost claim means another machine holds the ref; releasing it deletes that machine's claim. `start-failed` also does not release: the episode is not ended for that attempt and a person is told elsewhere.
- **A branch with work stays and is reported.** `releaseClaim` refuses a file-changing commit, so the release is a no-op for a repair agent that committed. A refusal does not hold the episode's close: `done` is already written, and a failed release only warns, as `ticketMergedRevert` does for a failed ticket.
- **A release failure never reverts the `done` write.** `done` is terminal (`transitions/repair-record.ts`); the record is not reopened.
- Carried-over invariants: absent is not false (an unreadable host answer is a refusal by `releaseClaim`, never a release); read the exit code, not the emptiness; the index never says `pr: 'none'`.

### Done when

The plan's `## Done when` list is the specification (the plan names the episode's release; slice 2 owns the board). Assertions that exist because a naive implementation passes without them:

- **`closePrs` with `outcome: 'ended'` and a claim-only branch calls the release port with that branch once.** A test that only asserts `state: done` passes with no release at all.
- **`outcome: 'lost'`, `start-failed` and an attempt with no outcome call the release port zero times.** The `lost` row catches the deletion of another machine's claim.
- **A refused release (`released: false`) leaves the record `done` and returns `closed`.** It catches a release that throws or holds the close.
- **The branch released is the record's attempt branch, not one recomputed from the reading.** Use a record whose `attempt.branch` differs from the settled SHA's, so a recomputation fails.
- **A second pass after `done` releases nothing.** `redMainStep` answers `none` for a terminal record; assert zero release calls on the next tick.

Plus the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. List no full suite. New code is arrow functions with factual TSDoc (behaviour only, history in the commit message). Add a changeset (description first, `bumps:` block last, `plan:` line inside the comment block, never first). A PR carries no generated bundle (`scripts/check-no-bundle-diff.sh`).

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file. If it does, remove an equal number of lines elsewhere in the same change, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines, and has no override.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves); never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/fleet/src/shared/revert-start.ts`, `revert-start-world.ts`, the `revertWorldOf` call in `packages/fleet/src/server/entry/registryd-main.ts`, and `packages/fleet/test/unit/revert-start.test.ts`. `repair-start.ts`, `releaseClaim` (`dispatch-verbs.ts`) and `release-claim-reader.ts` are read-only: the release decision is reused, not changed. The board's Quiet classification (`packages/board/src/server/fleet.ts`) belongs to the second slice.

Branches in flight, verified 2026-11-08 with `git ls-remote --heads origin`: `bug/main-repair-0232c10cf5db` (a live repair claim of the current episode; do not touch it) and `plot/release-no-controller-resumes-a-claimed-slice` (another plan). Neither touches these files. Rebase onto `main` before the PR.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
