## Implementation brief — every-desk-state-has-an-exit (slice 3: The desk has a lifecycle)

- **Plan (canonical):** `docs/plans/2026-10-03-every-desk-state-has-an-exit.md` on `main`
- **Approved:** 2026-10-03, jwloka, in-session
- **Branch:** `bug/the-desk-has-a-lifecycle` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** the PR, per repo convention
- **Issue:** #1242, #1243

This is slice 3 of 3 and the last. Slice 1 (`bug/an-empty-claim-is-not-unlanded-work`) merged as #1244 and slice 2 (`bug/a-refused-slice-is-held`) as #1251. Nothing waits on this slice.

### What to build

Measured 2026-10-03: `.worktrees/` held 269 desks and 250 of them came from one slice, at 17 to 19 desks an hour. Slices 1 and 2 stop that loop: an empty claim no longer keeps a desk, and a refused slice leaves the queue. Neither gives the domain a list of desk states, so the next way a desk gets stuck is found by counting desks. `9260f8a65` fixed one entry (`plot-dispatch.sh --release` detaches a released desk); slice 1 fixed another. This slice makes the question *what state is this desk in, and what is its exit* a domain rule.

Add `packages/domain/src/rules/desk-lifecycle.ts`. It exports a `DeskState` union, a `DeskExit` type and `deskLifecycle(readings)`. The plan's table is the first cut of the states: `working`, `finished`, `orphaned`, `refused-empty`, `refused-with-work`, `holding-work`, `unplaced`. Readings are values the caller takes: the fields `TreeReadings` already carries (`workerPid`, `dirtyPath`, `blockedMarker`, `merge`, `unpushed`), the slice-1 reading of file-changing commits (`isEmptyClaim`/`realCommits` in `rules/empty-claim.ts`), and two new ones — `claimRef` (does `origin/<branch>` exist) and `markerRecordsWork` (does the desk hold anything besides the marker). The rule reads no file and spawns nothing.

Then make the two callers ask it. `reapProblems` in `rules/reapable.ts` stops refusing every desk that carries a marker: `blocked-marker` fires only for `refused-with-work`, and a `refused-empty` desk is reapable once its marker text is saved. Reconcile §21 (`skills/plot/scripts/plot-reconcile-scan.sh:2545`, through `board/plot-reconcile.mjs`) reports the lifecycle state and the exit instead of combining readings itself. Reaping `refused-empty` copies the marker's text to `.plot/state/refusals.tsv` before the desk goes; the reaper owns that copy, because a refusal is evidence even when its desk holds nothing.

Open question 3 in the plan is yours to settle: which `desk-*` rules fold in and which stay as readings. The plan fixes one answer — `deskManifest` is unchanged and the lifecycle rule reads its answer for `unplaced`. For `desk-worker.ts` decide by measurement (does `working` need more than `deskWorker`'s `here`/`left`?), and record the answer in the plan's Open Questions as a dated line before you build.

### Decisions the plan settles — do not re-derive them

**The rule is the exit list, and totality is its test.** Rejected: one more guard for the way a desk got stuck today. Each of the two earlier fixes guards one entry, and the estate found the third by counting 250 desks. The rule's test enumerates every member of `DeskState` and asserts it maps to an exit; an exit of *a person* carries a non-empty person-facing reason. A new state added to the union without an exit fails to compile or fails that test.

**A rule never removes a desk that holds work.** `refused-with-work` and `holding-work` exit to *a person*, named on the board. No removal uses `--force`; git's own refusal stays the last gate (`git worktree remove`, no `--force`, did not refuse on `free-50562867`). A desk with a file-changing commit or uncommitted work beside the marker is `refused-with-work`.

**`orphaned` means all four: no live worker, no claim ref, no file-changing commit, clean tree.** Slice 1 measured the case: `free-50562867` held one commit, `a20c71285 plot: claim …`, which changes no file, and its ref was gone. Rejected: reading an absent `@{upstream}` as *unknown, keep* — `plot-worker-loop.sh:963-972` did, and kept the desk. A missing `claimRef` alone is not `orphaned`; the other three readings must hold.

**`markerRecordsWork` is a reading, not a parse.** The caller measures whether the desk holds anything besides the marker (dirty paths other than `PLOT-BLOCKED*`, commits beyond the claim). The rule does not read the marker's prose for a branch name or a verdict; slice 2 refused that for the same reason.

**The marker text moves, it is not dropped.** Measured 2026-10-03: 250 markers were trashed by hand only where the desk was detached, its sole uncommitted path was `PLOT-BLOCKED.md`, the marker named `free-50562867`, and no worker pid was live. Two desks failed that check and kept their markers. Those four conditions are the evidence for `refused-empty`; the saved line in `refusals.tsv` is what keeps it once the desk is gone.

Rules carried over unchanged from related work, so they are not re-learned by breaking them:

- Absent is not false. A reading the caller could not take is `unknown` and keeps the desk (`checkoutYield`'s polarity, `reapable.ts`'s `unpushed: 'unknown'`).
- Read the host's `mergedAt`, never ancestry and never a PR's `state`, for `finished` (`scripts/check-ancestry-decisions.sh` bans the other reading).
- Where the shell and the TypeScript both answer the same question, a corpus test holds the pair. `plot-reap.sh` and `plot-release-refs.sh` already call the reaper; if this slice leaves a shell copy of any lifecycle test, add it beside `packages/domain/corpus/desk-reset.corpus.test.ts`, and on a disagreement stop rather than adjust either side (CLAUDE.md, *A Shell Script Asks The Domain*).
- Arrow functions for every function you write, including tests. TSDoc states what an export does, its parameters, its return and how it fails; the history goes in the commit message.
- The domain names the actor *Agent*. Use `Slice` where you mean a slice, never `Wave`.

### Done when

The plan's slice line is the specification: `rules/desk-lifecycle.ts` names each desk state and its exit, and `reapable.ts` and reconcile §21 ask it. These assertions exist because a naive implementation passes without them:

- Every `DeskState` maps to an exit. Catches a state added with no way out, which is the defect the plan is named for.
- Every exit of *a person* carries a non-empty reason. Catches an exit the board cannot word.
- A desk with only a marker, no worker, no file-changing commit and a clean tree reads `refused-empty` and is reapable. Catches `reapProblems` still refusing every marker.
- The same desk with one extra dirty path, or one file-changing commit, reads `refused-with-work` and is not reapable. Catches the reaper widening past the measured case.
- A desk with a claim-only commit, no claim ref, no worker, no marker and a clean tree reads `orphaned`. The same desk with a file-changing commit reads `holding-work`. Catches slice 1's reading being re-derived wrongly.
- A desk with a live worker reads `working` whatever else it holds. Catches a lifecycle that outranks the one signal describing someone acting now.
- A desk with `unknown` for `unpushed` or for `claimRef` is not removed by a rule. Catches silence read as permission.
- Reaping a `refused-empty` desk writes its marker text to `.plot/state/refusals.tsv` before the removal, and a failed copy keeps the desk. Catches a marker destroyed with its evidence.
- Reconcile §21 prints the state and the exit for a fixture desk of each state, and says it could not evaluate (as it does today) when the bundle is missing. Catches a report that is silent on the desks it cannot ask about.
- `reapProblems`' existing tests in `packages/domain/test/reapable.test.ts` and the pairs in `corpus/desk-reset.corpus.test.ts` still pass unchanged where the behaviour did not change. Catches an edit that moved a refusal nobody meant to move.

Plus the repo's gates:

- A `.changeset/*.md` description first, `bumps:` block last, with `plan: docs/plans/2026-10-03-every-desk-state-has-an-exit.md` in the block. Skill bumps go in the block; a `packages/board` change names `'@plot-pm/board': patch` in the frontmatter. Copy the format from a recent changeset in git history.
- `pnpm build:board` after any `packages/board/src` change or any change a bundle under `skills/plot/scripts/board/` is built from, then commit the rebuilt artifact. On a conflict in `board-server.mjs`, take either side and rebuild.
- A new script or a changed helper table row: `scripts/check-helper-table.sh` is the gate.

Before each push, run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. The suites in the `CI suites` key run in CI; a failure there comes back as a correction. Run no full suite locally, and not `test:e2e`.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`. Then append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`, from a detached scratch worktree on `origin/main`.
- Record the answer to open question 3 in the plan as a dated line.

### Scope guard

This branch owns `packages/domain/src/rules/desk-lifecycle.ts` and its test, the `blocked-marker` branch of `reapProblems` in `packages/domain/src/rules/reapable.ts` and `packages/domain/test/reapable.test.ts`, the transition that asks `reapProblems` (`packages/domain/src/transitions/worktree.ts`), reconcile §21 in `skills/plot/scripts/plot-reconcile-scan.sh` and the bundle it asks (`board/plot-reconcile.mjs`), and the marker copy in `skills/plot/scripts/plot-reap.sh`.

Do not edit `rules/checkout-yield.ts`, `rules/empty-claim.ts` or `rules/queue.ts`: slices 1 and 2 are done. Do not change `deskManifest` (the plan's boundary with `a-desk-and-its-manifest-name-each-other`).

In flight, verified 2026-10-03 against `git ls-remote --heads origin`: `bug/a-desk-with-no-manifest-says-so` (plan `a-desk-with-no-manifest-says-so`) owns `rules/desk-manifest.ts`, `registry.ts`'s `synthesizeEntry`, `schema.ts`'s `AgentEntrySchema` and `rows.tsx`. Read `deskManifest`'s answer for `unplaced` and do not edit the file. If it merges first, rebase before you touch `schema.ts` or `registry.ts`; a rebase that drops work shows as a diff against `origin/main`, so check it before pushing.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
