## Implementation brief — every-desk-state-has-an-exit (slice 3: The desk has a lifecycle)

- **Plan (canonical):** `docs/plans/2026-10-03-every-desk-state-has-an-exit.md` on `main`
- **Approved:** 2026-10-03, jwloka, in-session
- **Branch:** `bug/the-desk-has-a-lifecycle` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** the PR, per repo convention
- **Issue:** #1242, #1243

This is slice 3 of 3 and the last. Slice 1 (`bug/an-empty-claim-is-not-unlanded-work`) merged as #1244 and slice 2 (`bug/a-refused-slice-is-held`) merged as #1251, so nothing waits on this slice and it waits on nothing.

### What to build

Measured 2026-10-03: `.worktrees/` held 269 desks and 250 of them existed because of one slice. A desk held `bug/the-queue-reads-the-scans-order` with one empty claim commit, no live worker and no claim ref. Each pass handed the slice to a free agent, the agent refused it with `PLOT-BLOCKED.md`, and `reapable.ts` kept every desk that carried a marker. Slices 1 and 2 stop that loop. This slice makes the next way to get stuck visible without counting desks.

Build `packages/domain/src/rules/desk-lifecycle.ts`: one rule that names every state a desk can be in and the exit each state has. The plan's table is the first cut (`working`, `finished`, `orphaned`, `refused-empty`, `refused-with-work`, `holding-work`, `unplaced`). Its input is the readings `reapProblems` and `checkoutYield` already take, plus two new ones the caller takes: `claimRef` (does `origin/<branch>` exist) and `markerRecordsWork` (does the desk hold anything besides the marker). The rule reads no file and spawns nothing.

Then make the two callers ask it. **Read the call chain before you edit, because the plan's wording is shorter than the code.** Reconcile §21 (`skills/plot/scripts/plot-reconcile-scan.sh:2545`) does not call `reapProblems`. It assembles tab-separated readings, pipes them into `board/plot-reconcile.mjs`, and `reconcile()` asks `reap()` in `workflows/reap.ts`, which asks `entities/worktree.ts:reapRefusals`, a thin adapter over `reapProblems`. `transitions/worktree.ts:294` calls `reapProblems` directly. `plot-reap.sh` takes its own readings. So "reapable.ts and §21 ask the lifecycle rule" means the readings and the exit decision reach `deskLifecycle` through those two paths, and the shell keeps taking readings only.

### Decisions the plan settles — do not re-derive them

**A rule names the exit, and the exit of a person-facing state names the reason.** The test the plan names is the property: every member of the state type maps to an exit, and an exit of *a person* carries a non-empty person-facing reason. Write it as an exhaustive `Record<DeskState, …>` so a new state fails the build until it has an exit. That is the whole point of the slice: the 250 desks came from a state the domain had no word for.

**No removal uses `--force`.** Rejected: forcing the removal of a desk that refuses. A desk holding a file-changing commit or uncommitted work is never removed by a rule. `refused-with-work` and `holding-work` exit to a person, and the board names them.

**The marker text is kept.** A refusal is evidence even when its desk holds nothing. `refused-empty` copies the marker to `.plot/state/refusals.tsv` and then reaps. The copy happens before the removal and the removal does not run if the copy failed. The measured clean-up trashed 250 markers by hand only where the desk was detached, its sole uncommitted path was `PLOT-BLOCKED.md`, the marker named the desk, and no worker pid was live; two desks failed that check and kept their markers. `markerRecordsWork` encodes that check, so test the two desks that failed it.

**`orphaned` is detach, then reap.** `9260f8a65` already made `plot-dispatch.sh --release` detach a released desk. A claim ref removed any other way still produces the state, which is why the rule names it. Slice 1's reading is the input: a commit that changes no file is not work, and `isEmptyClaim` (`rules/empty-claim.ts`) is the existing rule for that. Reuse it; do not re-derive "empty".

**`checkoutYield` does not change.** It still keeps on `unknown`. Slice 1 changed the reading it is given and not the rule.

**Carried-over invariants.** Absent is not false: `unknown` keeps the desk, because a removal cannot be undone (`checkout-yield.ts`). A merged PR reads `mergedAt`, never `state` and never ancestry (`plot-pr-merged.sh`); `finished` uses that answer and no other. Read the exit code, not the emptiness, for every git call a new reading makes.

### Open questions this branch settles first

The plan leaves three open. Settle each with a measurement, record the answer in the plan's Open Questions as a dated line, then build it.

1. Which `desk-*` rules fold into the lifecycle (`desk-worker.ts`, `desk-manifest.ts`) and which stay as readings it consumes. The plan fixes one side: `deskManifest` (from `a-desk-and-its-manifest-name-each-other`) does not change, and the lifecycle reads its answer. The default is to consume both and fold neither; fold one only if you can show the lifecycle would otherwise decide the same question twice.
2. Where `claimRef` comes from. `refs` is the adapter that reaches git refs; check whether it already answers "does `origin/<branch>` exist" before adding an operation.
3. Where `markerRecordsWork` is read, and how the shell and the domain agree on it. If a shell reading and the domain rule both decide "the desk holds nothing besides the marker", that is a duplicated rule and joins the corpus tier (`packages/domain/corpus/`, see `desk-reset.corpus.test.ts` for the shape). Do not adjust either side to make the comparison pass.

If a question cannot be settled by a measurement, write `PLOT-BLOCKED.md` and report. Do not guess.

### Done when

The plan's slice line is the specification. These assertions exist because a naive implementation passes without them:

- Every `DeskState` maps to an exit, and a person-exit has a non-empty reason. Catches a state added with no way out, which is the failure the plan is named for.
- A desk with no live worker, no claim ref, only an empty claim commit and a clean tree reads `orphaned`. The same desk with one file-changing commit reads `holding-work`. Catches an "empty" test that is a commit count.
- A desk whose only content is `PLOT-BLOCKED.md` reads `refused-empty`; the same desk with one other uncommitted path reads `refused-with-work`. Catches the marker alone deciding.
- `refused-empty`'s exit copies the marker before the removal. Assert the order, and assert no removal when the copy fails.
- `reapable.ts`'s `blocked-marker` refusal no longer fires for a `refused-empty` desk and still fires for `refused-with-work`. Catches the lifecycle being added beside the old refusal rather than replacing it.
- A `working` desk is never reaped, whatever else it holds.
- Reconcile §21 reports `unplaced` and the person-exits as it reports desks today, with the rule's reason as the evidence. The existing §21 tests in `test/reconcile/` must pass unchanged where the behaviour is unchanged.

Plus the repo's gates:

- A `.changeset/*.md` naming `'plot': patch`, and `'@plot-pm/board': patch` only if the board package changes. Description first, `bumps:` block last, with `plan: docs/plans/2026-10-03-every-desk-state-has-an-exit.md` in the block. A board-only change uses the package frontmatter and no `bumps:` skills entry.
- `pnpm build:board` after any `packages/board/src` change, then commit the rebuilt artifact. On a conflict in `board-server.mjs`, take either side and rebuild.
- Arrow functions and factual TSDoc for everything in `packages/domain`. A TSDoc block says what an export does, its parameters, its return and how it fails; the reasoning goes in the commit message.
- A new script, if any, gets a row in `skills/plot/scripts/README.md` (`scripts/check-helper-table.sh`).

Before each push, run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. The suites in the `CI suites` key run in CI; a failure there comes back as a correction. Run no full suite locally, and not `test:e2e`.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`. Then append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`.

### Scope guard

This branch owns `packages/domain/src/rules/desk-lifecycle.ts` and its test, the changes to `rules/reapable.ts`, `entities/worktree.ts`, `workflows/reap.ts` and `transitions/worktree.ts` that route their decision through it, the readings in `plot-reap.sh` and reconcile §21, and the `.plot/state/refusals.tsv` write.

Not in this branch: `rules/queue.ts` and the `refused` hold (slice 2, merged), the `unpushedCommits` reading in `plot-worker-loop.sh` (slice 1, merged), and `deskManifest` (`a-desk-and-its-manifest-name-each-other`).

Branches in flight, verified 2026-10-03 against `origin/main`: none holds this slice's files. `skills/plot/scripts/plot-reconcile-scan.sh` and `plot-worker-loop.sh` are busy files, so run `git log origin/main -- <file>` before editing them and put any shell test in a file of its own.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
