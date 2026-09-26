## Implementation brief — a-corpus-test-says-what-it-verifies

- **Plan (canonical):** `docs/plans/2026-09-26-a-corpus-test-says-what-it-verifies.md` on `main`
- **Approved:** 2026-09-26, Jan Wloka, in-session after panel (round 1)
- **Branch:** `infra/a-corpus-test-says-what-it-verifies` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — the PR is reviewed as code
- **Issue:** #1011

Single-slice plan. Nothing waits on this branch, and it waits on nothing. `bug/a-branch-behind-main-holds-nothing` changes `branch-state.ts:264` later, and this docstring is what its implementer reads when the corpus goes green.

### What to build

A comment change in ONE file: `packages/domain/corpus/branch-state.corpus.test.ts`. The code does not change.

The defect: the docstring at `:22-31` says the rule is *"VERIFIED rather than reviewed"*. That claim is false for the decision. The scan's only branch-state answer comes from `node board/plot-branch-state.mjs` (`plot-fleet-scan.sh:3620`), and that bundle is built from the same `branchState` the test calls. The plan's measurement: mutant B (`branch-state.ts:187`, `'merged'` → `'wip'`, an arm that 20 of 26 branches reach) **fails with a stale bundle and passes with a rebuilt bundle**. The broken rule is the same in both runs. Only the rebuild changes the result.

What the test DOES verify is real. The test gathers the readings itself (refs, the merge walk, one `pr-list`, the plan's annotations), so a scan that gathers a reading wrongly makes the two sides disagree. It is a real comparison of the input gathering and a tautology about the decision.

The plan is canonical. This brief gives orientation only.

### Decisions the plan settles — do not re-derive them

**Adopt the wording that already exists. Do not write a second phrasing.** `sprint-score.corpus.test.ts:23-28` already describes this shape: *"SO WHAT THIS NOW HOLDS IS THE WIRE … the two can still part, just at the seam rather than in the rule."* Model the new paragraph on it. The corpus tier stays one vocabulary.

**The CI asymmetry is the non-obvious half. Say it explicitly.** The `corpus` job (`ci.yml:60`, it runs `test:corpus` at about `:94`) does NOT build the board, so it runs against the committed bundle. It catches a contributor who edits the rule and forgets to rebuild. `ci.yml:873` ("Board build + artifact freshness") is a separate job that rebuilds and fails on a stale artifact. **So the careless edit is caught and the careful one, which rebuilds per the Definition of Done, goes green.** Verified at dispatch: the corpus job has no build step.

**No new assertion.** Freshness is already gated at `ci.yml:873`. A freshness check inside the corpus test duplicates a shipped gate.

**No rename.** The corpus tier is a named concept, and `sprint-score.corpus.test.ts` holds the same shape under honest wording.

**Do not add a second `branchState` implementation.** `a-sprint-item-has-one-scorer` removed exactly that duplication on 2026-09-08. The plan does not argue against one rule with one implementation.

**Do not touch `branch-state.ts`.** The correctness of the rule is `a-branch-behind-main-holds-nothing`'s question. This also settles where the arm-coverage note goes: in the corpus test, not as a comment in the rule.

**The survey of the other corpus files is done.** Of nine files, only this one has the undocumented shape. `deliverable.corpus.test.ts` is a genuine second implementation, and `sprint-score` is already documented. Do not edit either.

### One thing the plan did not name — resolve it inside this file

The existing mutation report at `:389-404` (the test *"names which states the estate actually exercised"*) is dated 2026-09-06. It says the no-ref **merge-subject lookup** is *"PASSES — never reached"* and that *"every merged branch here still carries a ref"*. The plan's coverage, measured 2026-09-26, is **4 branches at `:183` (`mergeSubjectFound`), 20 at `:187` (`pr === 'MERGED'`), 2 on the has-ref arm, 0 at `:264`**. The estate changed: `plot-release-refs.sh` has since deleted merged refs, and the remote now holds 8 heads. If the 09-06 table stays as it is next to the new numbers, it contradicts them.

Record the 2026-09-26 coverage in that report comment. Keep the 09-06 table as the dated measurement it is, and state which of its claims the new numbers supersede. This is the "where the next reader of `branch-state.ts` will find it" requirement in *Done when*. Do not re-run a mutation survey: the plan's numbers are the measurement. If the numbers disagree with what the test's own report prints today, stop and report the disagreement. Do not reconcile it by hand.

### Done when

The plan's `## Done when` list is the specification:

- The docstring names the independent half (the readings), the dependent half (the decision), and the CI asymmetry.
- It adopts `sprint-score.corpus.test.ts:23`'s wording.
- The arm coverage — 4 / 20 / 2 / **0 at `:264`** — is recorded, and `:264` is named as unreached. `a-branch-behind-main-holds-nothing` changes exactly that line, so a green corpus says nothing about its change.
- No rename, no new assertion, no other corpus file touched.

A naive implementation passes these without two things. First, it softens *"VERIFIED"* and does not name the rebuild asymmetry, which leaves a reader who rebuilt as confident as before. Second, it appends the new coverage and leaves the 09-06 "never reached" line uncorrected, so the report contradicts itself.

The repo gates:

- `nvm use` (Node 24; `corepack pnpm` if homebrew pnpm crashes)
- `pnpm --filter @plot-pm/domain run test:corpus` — must stay green; the change is comments only
- `pnpm run typecheck`
- a changeset: `'plot': patch`, description first, and no `bumps:` block (no skill changes). Copy the format from git history if `.changeset/` is empty.

Do not run `test:e2e` locally.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh`, not `gh pr create`.
- When the PR exists, append ` → #<number>` to this branch's heading in the plan's `## Slices` (heading form: `(Branch: infra/a-corpus-test-says-what-it-verifies, PR: #N)`). Make that edit on `main`.
- No project board is configured, so there is no status to set.

### Scope guard

This branch owns `packages/domain/corpus/branch-state.corpus.test.ts` and one `.changeset/*.md`. Nothing else.

In flight at dispatch (2026-09-26), verified by diff against `origin/main`:

- `bug/a-branch-behind-main-holds-nothing` — claimed, no commits yet. It will change `packages/domain/src/rules/branch-state.ts` and may touch this corpus file. If it lands first, rebase and keep both texts.
- `bug/a-claim-is-released-not-deleted` — claimed, no commits yet.
- `bug/the-index-is-read-once` — `plot-reconcile-scan.sh`, `test/reconcile/`. No overlap.
- `feature/one-monitor-watches-the-slice` — `packages/board/**`. No overlap.
- `feature/the-domain-knows-a-round` — no file changes yet.

If you find something the plan did not anticipate, report it. Do not improvise outside scope.
