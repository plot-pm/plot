## Implementation brief — a-foreign-slice-reads-its-own-pr (wave: Own PR)

- **Plan (canonical):** docs/plans/2026-11-28-a-foreign-slice-reads-its-own-pr.md on main
- **Approved:** 2026-11-28, jwloka, plan-PR #3763 merged
- **Branch:** `bug/a-foreign-slice-reads-its-own-pr` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (CI required on main)

This is the only wave of the plan. It follows `a-foreign-slice-is-never-claimed-here`, which is delivered: `foreign` is already a branch state, and `sliceForeignRepo` and `sliceForeignReference` already exist. Do not rebuild them.

### What to build

Issue #3762, observed on Plot 2.36.1 in a Bitbucket checkout: a plan with a local slice naming PR 16 of its own repository and two foreign slices naming `ws/portal` PR 31 and `ws/apps-infra` PR 176, all merged. `plot-impl-status.sh` read `ws/portal` PR 31 as `MERGED`. `plot-fleet-scan.sh` read both foreign branches `open`, held wave 2 `blocked`, and offered a foreign branch for hand-over. PR #3743 fixed the hand-over and the blocked wave. Three differences remain on main, and your fix is the fix when all three close:

1. The branch row of a merged foreign slice reads `foreign — lives in <repo>, not claimed here` (`workflows/plan-walk-report.ts:66-67`), where `plot-impl-status.sh` reads `MERGED`.
2. The walk asks by branch name: `host.prMerged(branch, { repo })` in `foreignPrFor` (`workflows/plan-walk-branches.ts:449-457`). `deliverabilityOf` asks by the PR number the line names: `host.prState(ref.number, { repo: ref.repo })` (`packages/board/src/server/controllers/deliverability.ts:202-216`), and folds several references as `unknown` over `not-merged` over `merged`. The two reads answer different questions, so the scan and `/plot-deliver` can disagree on one plan.
3. `foreignPrFor` maps a failed host call and an unmerged PR both to `unreadable` (`:455`). Nothing tells a host that did not answer from a PR that is still open.

Build, in this order:

1. A domain rule `crossRepoMergeState` in `packages/domain/src/rules/` (beside `cross-repo-reference.ts`). It takes the `prState` answers for a branch's `owner/repo#N` references and returns `merged`, `not-merged` or `unknown`, with the fold of `deliverability.ts:206-210`. Keep the per-reference names that `deliverabilityOf` builds for its refusal text. Reuse the reference parser of `cross-repo-reference.ts` (`REFERENCE`, `sliceForeignReference`); do not copy a second regex.
2. `deliverabilityOf` calls the rule in place of its inline fold. Its behaviour does not change: its existing tests are the proof, and they must pass untouched.
3. The walk calls the same rule. `foreignPrFor` asks `host.prState(N, { repo })` for each reference of the line, not `prMerged(branch, { repo })`, and keeps its memo (`foreignAsked`).
4. A merged foreign branch reads `merged`. Let `branchState` return `merged` for a foreign branch whose rule answer is `merged`, so the report row, the wave settle and `progress.work` read the same state as a local branch. `foreignSettled` (`plan-walk-assembly.ts:325`) and the `foreignMerged` test at `plan-walk-branches.ts:601` become the ordinary `merged` test. Where `foreignMerged` leaves the readings, `entities/view-readings.ts:66` and the snapshot fixture `packages/domain/test/fixtures/snapshot-protocol/protocol-10.shape.json` change with it: check what the snapshot-protocol gate requires for a shape change before you edit that fixture, and run the tests that name it.
5. An `unknown` answer keeps `foreign`, and the report names the PR read as unknown. The plan's Open Questions recommend the report wording; state the one you choose in the PR body.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**One rule, two callers; the scan does not get a second implementation.** The walk and `deliverabilityOf` call one function. A copy in the walk is the failure the plan exists to remove: two folds drift, and the scan and `/plot-deliver` disagree again. Shell is not touched: `plot-impl-status.sh` keeps its own resolution, and the test below holds the pair.

**The walk asks `prState(N)`, not `prMerged(branch)`.** `prMerged(branch, { repo })` asks which PR carries the branch name in that repository. A foreign slice names the PR it means, and a branch name that six repositories share answers a different question. The number is the identity.

**The index never says no.** `not-merged` and `unknown` both keep `foreign`. The branch state is never `unknown` or `open` for a foreign line, because both are startable (`rules/verdict.ts:64-74`) and a foreign branch must never be handed over here. A failed `prState` is absent knowledge: it is not `not-merged`, and it is not `merged`. The report may differ between the two; the state does not.

**A line with no arrow asks nothing and stays `foreign`**, as on main (`arrow: false` in `foreignOf`). Do not guess a PR from the branch name.

**One open reference keeps a branch `foreign`.** A branch line may name references in several repositories. Take the `deliverabilityOf` fold: `unknown` over `not-merged` over `merged`, so one open or unreadable reference holds the branch.

**Ancestry is not the question.** "Did this land" is the foreign PR's `mergedAt` through the host (*One Answer To "Did This Land"*). Add no `merge-base` call and no `# plot-ancestry:` declaration.

**Cost.** One `prState` per `owner/repo#N` reference of a live plan per pass, memoised per pass. Measure the count on the fixture and state the number in the PR (open question `[question-host-cost]`). A cross-pass cache of a `MERGED` foreign answer is a later plan (`[question-terminal-cache]`): the PR index keys rows by this repository's branch and holds no foreign repository. Do not extend the index.

**`foreign` outranks every git reading, as before.** The rule changes what a foreign branch reads only through the PR answer. A claim commit and an open ref still read `foreign` unless the rule answers `merged`. Keep the tests of the delivered slice passing.

### Done when

The plan's `## Slices` entry lists the tests; they are the specification. First run the reporter's fixture against main and record what still differs, before you change code. Then:

- the fixture (a local slice naming PR 16, foreign slices naming `ws/portal` PR 31 and `ws/apps-infra` PR 176, all merged) reads all three branches `merged`, wave 2 eligible, and the walk and `deliverabilityOf` agree — this catches a walk that still asks by branch name and answers `foreign` for a merged PR;
- a not-merged foreign PR reads `foreign` — this catches a rule that settles on any answer;
- a failed `prState` reads `foreign` with the PR read named unknown, never `open` or `unknown` state — this catches the conflation in difference 3;
- a foreign line with no arrow asks nothing (assert the host port received no call) — this catches a branch-name fallback;
- a branch with two references, one open, reads `foreign` — this catches a fold that takes the first or the last answer.

Add one the plan does not list, because a naive implementation passes without it: a test that runs the walk and `deliverabilityOf` over the same references and the same `prState` answers, for every combination of `merged`, `not-merged` and `unknown` over two references, and asserts one answer. This holds the "one rule" claim against a later copy.

Plus: a changeset (`plot` patch) with the description first and the `bumps:` block last, naming the skills whose text you change, and the plan on a `plan:` line (`docs/plans/2026-11-28-a-foreign-slice-reads-its-own-pr.md`). Its description states the behaviour: a slice in another repository reads `merged` when the PR its line names is merged. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there returns as a correction. Run no full suite and no `test:e2e`. Commit no generated board bundle (`check-no-bundle-diff.sh`).

If the slice touches a `.sh` file, `scripts/check-shell-lines.sh` refuses growth: remove shell elsewhere in the same change, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines, and has no override. This slice needs no shell.

New functions are arrows. TSDoc states what the export does, its parameters, its return and its failure, and carries no history. Exhaustive `switch` statements over `BranchState` stay exhaustive: no `default` to silence the typechecker.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while it moves); never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line under `### Own PR` in the plan. Push the first real commit as soon as it exists. Issue #3762 is the plan's issue.

### Scope guard

This branch owns: `packages/domain/src/rules/` (the new rule, `branch-state.ts`, `cross-repo-reference.ts`), `workflows/plan-walk-branches.ts`, `workflows/plan-walk-assembly.ts`, `workflows/plan-walk-report.ts`, `entities/view-readings.ts` and the snapshot-protocol fixture it forces, `packages/board/src/server/controllers/deliverability.ts`, and their tests.

No other branch of this plan is in flight. `a-foreign-slice-is-never-claimed-here` and `a-foreign-slice-has-one-written-form` touch the same files and are delivered; read their merged diffs before you edit a shared line. Verify other open branches with `git diff --stat origin/main...origin/<branch>` before you edit a shared file.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
