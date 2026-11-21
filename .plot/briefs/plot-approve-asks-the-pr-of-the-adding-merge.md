## Implementation brief — plot-approve-finds-a-plan-pr-at-any-age (wave 2: Approve route)

- **Plan (canonical):** docs/plans/2026-11-21-plot-approve-finds-a-plan-pr-at-any-age.md on main
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3617 merged
- **Branch:** `bug/plot-approve-asks-the-pr-of-the-adding-merge` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This branch waits on `bug/the-host-names-the-prs-of-a-commit` (wave 1), which merged as #3625 and put `Host.prsOfCommit(sha)` on the port (`packages/domain/src/ports/host.ts:595` on `origin/main`). The branch `bug/plot-approve-refuses-a-slice-on-the-plan-branch` (wave 3) waits on this one: it needs `readings.pr.branch` set from the merged route, which only this slice does.

### What to build

`plot-approve` refuses a plan whose plan PR merged more than 100 merged PRs ago. Measured 2026-11-21 on `templates-show-named-identifiers`: PR #3478 merged 2026-11-17 as merge commit `1d814d0a1`, second parent `0835e43b7`; 104 PRs merged after it; `choosePlanPr` asks `ctx.host.prList('merged', PRS_LISTED)` with `PRS_LISTED = 100` (`packages/board/src/server/entry/open-prs.ts:5`, `:210-216`), so the PR is not in the page, `planPrOf` answers `none` (`packages/domain/src/rules/plan-pr.ts:311`), and the domain refuses `pr-absent` with `no PR found for branch 'idea/<slug>'` plus *Push the branch* — wrong advice for a branch that merged.

The fix, on top of wave 1's port operation:

1. **`planPrOf` asks by commit first.** After `addition`, it asks `commit` (new `PlanPrReadings.byCommit`: `readonly Pr[]` or `'unaskable'`). It takes the row whose `state` is `MERGED`, whose `headSha` matches the second parent (`shaMatches`, `plan-pr.ts:208`) and whose `mergeCommit` equals `addition.sha`. That row carries both facts the `confirm` ask reads today, so this route asks no `confirm`. The answer names the row's `head` as `branch` (today the merged route returns `branch: ''`, `plan-pr.ts:322`).
2. **The list is the fallback.** Where `byCommit` is `'unaskable'`, the rule asks `merged` and `confirm` as today; `MergedPr` gains `head` so the fallback also names the branch.
3. **A new outcome `{ outcome: 'unnamed', mergeCommit, via: 'commit' | 'list' }`** replaces `none` where no row or listed PR matches, including an empty `[]` answer. A file that arrived by squash or direct push has no second parent and still answers `none` (`plan-pr.ts:308`).
4. **`choosePlanPr` (`open-prs.ts:161-233`)** answers the `commit` ask with `ctx.host.prsOfCommit(secondParent)`. A `failed` answer throws `refuseOnHostFailure`, as the `merged` ask does at `:212-214`. It passes `unnamed` through. `needs-design.ts:358` and `interrogate.ts:207` read `unnamed` as they read `undefined` today.
5. **The entry adds only `prsOfCommit` in-process.** `approve.ts:778` builds `hostShell(context)`. Export a builder (`approveHostOf`) that keeps `hostShell` for every operation and replaces only `prsOfCommit` with the one `hostReadsFor` composes. `prList`, the merge and the `plot/review` status write stay on the shell.
6. **Same-branch route.** Where `sameBranch` holds and the default branch holds the plan file, call `choosePlanPr` with `onMain: true` instead of `readPlanPr(ctx, sameBranchOf(slug))` (`approve.ts:905-906`). `sameBranchOf` (`:301-313`) returns the bare slug where no `<prefix>/<slug>` ref exists, which never had a PR. A same-branch plan not on the default branch keeps `readPlanPr`. Under `same branch` nothing merges; a found MERGED PR approves with `merged=already`.
7. **`pr-merge-unnamed`.** `ApproveReadings.pr` gains `unnamedMerge?: { sha; via }`. `approve` (`packages/domain/src/workflows/approve.ts:358`) and `approveSpike` (`:568-572`) refuse `pr-merge-unnamed` before `pr-absent`. The entry's `refusalText` (`approve.ts:476`) prints the two texts the plan quotes verbatim for `via: 'commit'` and `via: 'list'`; assert them line by line.
8. **`skills/plot-approve/SKILL.md:273`** drops *"one host call, at most 100 merged PRs"* and states the commit route and the refusal.

Line numbers are from the plan, measured at `d40c8dc7d`; `origin/main` has moved, so re-read each site before editing.

### Decisions the plan settles — do not re-derive them

- **No shell `plot-host.sh pr-of-commit` op.** Decided by the operator 2026-11-21. With no host credential the route falls back to the newest 100 merged PRs and refuses `pr-merge-unnamed` with `via: 'list'`, whose text names the credential as the repair. A shell op would add shell lines `scripts/check-shell-lines.sh` makes you pay for.
- **Only `prsOfCommit` moves in-process.** Moving `prList`, the merge and the status write to `hostReadsFor`, as `merge-ports.ts:35-42` does, is a separate change. The open route and the batch route (`test/reconcile/approve-batch.test.mjs`) must behave as today.
- **The index and the list never say "no PR".** An empty `[]` from the commit answer is `unnamed`, not `none`: absent is not false. Only a file with no second parent (squash, direct push) answers `none`.
- **`needs-design` keeps the 100-PR limit.** It builds its own `hostShell(context)` (`needs-design.ts:299`), so its `commit` ask answers `unaskable`; it only reads `unnamed` as no PR. `interrogate` pre-fills an empty addition and never reaches the merged route.
- **Do not add `slice-on-plan-branch` here.** That is wave 3. This slice only sets `readings.pr.branch`.
- A `failed` commit answer refuses (host failure); `unaskable` falls back to the list. Do not conflate them.

### Done when

The plan's `### Tests per slice` list for *Approve route* is the specification:

- `packages/domain/test/rules-plan-pr.test.ts` — an adding merge asks `commit`; of two rows, the one matching second parent and merge commit answers `found` with its branch and no `confirm` ask (catches an implementation that takes the first MERGED row); `[]` answers `unnamed`/`commit` with no `merged` ask; a row whose merge commit differs answers `unnamed`; `unaskable` asks `merged` and the fallback names the listed PR's branch or answers `unnamed`/`list`; a squash or direct push answers `none`.
- `packages/domain/test/workflows-approve.test.ts` — `pr-merge-unnamed` names the merge commit and outranks `pr-absent`.
- `packages/domain/test/approve-spike.test.ts` — an unnamed merge refuses `pr-merge-unnamed`; a named one approves the spike.
- `packages/board/test/unit/approve.test.ts` — a plan whose PR is absent from the fake host's newest 100 merged PRs approves through `prsOfCommit` and `prList('merged')` is never called (catches a fallback that always runs); a same-branch plan on the default branch whose plan PR merged from `docs/<slug>`, with no `<prefix>/<slug>` ref, approves with the PR named; a same-branch plan not on the default branch with no prefixed ref still refuses `pr-absent` for the bare slug; a squash-added plan refuses `pr-absent` as today; both `pr-merge-unnamed` texts asserted line by line.
- `packages/board/test/unit/approve-host.test.ts` — `approveHostOf` answers `prsOfCommit` from the composed in-process host and `prList`, `prMerge` and the status write from the shell host.
- `packages/board/test/unit/needs-design.test.ts` — a merged-route plan whose PR the host cannot name reads as no PR.
- `packages/board/test/unit/interrogate-route.test.ts` — the pre-filled empty addition answers `none` and `prsOfCommit` is never asked.

Plus: a changeset (description first, `bumps:` block last, `plot-approve: patch`; run `./scripts/check-changeset-packages.sh`), and the Board impact comment already in the plan holds — no plan format or template change. Do not run `pnpm run test:e2e` locally. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI and a failure there comes back as a correction. `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grows; this slice should touch no `.sh` file. If it must, pay for the growth in the same change.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.

### Scope guard

This branch owns: `packages/domain/src/rules/plan-pr.ts`, `packages/domain/src/workflows/approve.ts`, `packages/board/src/server/entry/approve.ts`, `open-prs.ts`, the readers of `unnamed` in `needs-design.ts` and `interrogate.ts`, `skills/plot-approve/SKILL.md`, a changeset, and the tests above. Wave 1 (`the-host-names-the-prs-of-a-commit`, merged #3625) owns `adapters/host/prs-of-commit.ts`, `host-reads.ts`, `host-shell.ts` and `host-fixture.ts`; use them, do not edit them. Wave 3 (`plot-approve-refuses-a-slice-on-the-plan-branch`) will edit `workflows/approve.ts` after this merges; keep your refusal additions local so its `slice-on-plan-branch` slots in after `pr-absent`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
