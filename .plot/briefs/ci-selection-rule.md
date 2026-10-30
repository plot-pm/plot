## Implementation brief — ci-runs-what-the-change-touches (wave 1: Selection rule)

- **Plan (canonical):** docs/plans/2026-10-30-ci-runs-what-the-change-touches.md on main
- **Approved:** 2026-10-30, Jan Wloka, plan-PR #2944 merged
- **Branch:** `feature/ci-selection-rule` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan-PR review channel)

This is the first wave. Three branches wait on it directly or transitively:
`feature/ci-reads-the-selection` (waits on this), `feature/corpus-reads-without-a-token`
(waits on that), and `feature/ask-merge-admits-the-repair-pr` (waits on `feature/the-repair-record`,
unrelated to this chain). Land this slice first — the CI job in wave 2 calls the bundle this
slice ships.

### What to build

CI (`.github/workflows/ci.yml`) currently runs every job on every pull request with no path
selection: the last 40 `CI` runs were 4 success / 26 failure / 5 action_required / 4 cancelled,
and a green run costs 17–20 minutes. `plot-local-checks.mjs` already maps changed paths to
commands via the `Local checks` config key and a domain rule — but CI does not call it, so the
local and CI selections can silently differ.

**This slice does not invent that rule.** `packages/domain/src/rules/local-checks.ts` (223
lines) and `skills/plot/scripts/board/plot-local-checks.mjs` already exist — they were built by
the prior plan `the-board-reads-a-pr-while-its-ci-runs` (delivered). Your job is to make that
same rule answerable by a standalone bundle CI's own job can call (list of changed paths in,
list of selected commands/suites out), and add the second half the plan calls out separately:
**a script-to-test map** — which test files run which shell script — derived from the tests' own
script references, held to the truth by a corpus test. Read `local-checks.ts` fully before
writing anything: `references: ReadonlyMap<string, readonly string[]>` in its `LocalChecksReadings`
interface is already the per-path "which test files name this path" input; check whether the
derivation of that map (today, presumably built by the CLI script or its caller) belongs in the
domain instead, since the plan says a corpus test must hold it.

### Decisions the plan settles — do not re-derive them

- **One rule, two readers, not two rules.** `rules/local-checks.ts` is the *starting point* —
  the plan explicitly says "the plan does not add a second rule beside it." If you find yourself
  writing a parallel CI-specific selection function, stop: extend or wrap the existing rule
  instead, and point both `plot-local-checks.mjs` and the new CI bundle at the same answer.
- **The map is corpus-held, not hand-maintained.** "A test that runs `plot-host.sh` is selected
  when `plot-host.sh` changes. The map is derived from the tests' own script references, and a
  corpus test holds the derivation." A static, hand-written map would drift the moment a test
  adds a new script call — read `docs/shell-and-domain.md`'s corpus-tier contract
  (`packages/domain/corpus/`) before choosing a shape; `corpus/sprint-score.corpus.test.ts` is
  the precedent for "derive it, then test both sides agree."
- **This slice ships the rule+map only — not the CI job wiring.** `feature/ci-reads-the-selection`
  (wave 2) is the one that adds the CI job calling this bundle and gates suites on its output.
  Scope this branch to the domain rule, the bundle `plot-local-checks.mjs` reads, and the
  corpus test for the script-to-test map. Do not touch `.github/workflows/ci.yml` here.
- **Always-run checks are out of scope for the rule's selection logic**, but note them for
  wave 2's context: `scripts/check-*.sh` gates and typechecks always run regardless of selection;
  a change to a plan, sprint or `.plot/` always selects `corpus` (also wave 2's job to wire, but
  this slice's rule must be able to express "always select corpus for these paths" — check
  whether `LocalCheck`'s glob matching already covers `docs/plans/**`, `docs/sprints/**`,
  `.plot/**` or whether the rule needs an explicit always-select list).
- **Project-agnostic design holds.** No hardcoded suite names, paths or project specifics outside
  what `## Plot Config`'s `Local checks` / `CI suites` keys already declare — this repo's config
  keys are the input, not literals in the rule.
- **Arrow functions in the domain package.** Anything you write or rewrite in
  `packages/domain/src/**` is `export const f = (…) => …`, never `function f(…) {}`. This repo's
  own board code (507 `function` vs 6 arrows) is not the model for new domain code.
- **Factual TSDoc only.** Say what the export does, its params, return and failure modes. No
  narration of alternatives considered — that goes in the plan and the commit message, not the
  comment block. Measured on this package already: one prior rule shipped 28 lines of code
  against 109 lines of comment.

### Done when

The plan's `## Done when` is implicit in its Slices and Design sections (this plan has no
explicit `## Done when` heading — treat the Slices entry as the spec): "the domain rule that maps
changed paths to checks; `plot-local-checks.mjs` reads it; a corpus test holds the script-to-test
map." Concretely:

- `packages/domain/src/rules/local-checks.ts` (or a sibling in `rules/`) exposes the changed-path
  → selected-checks mapping as a pure function callable from both `plot-local-checks.mjs` and a
  future CI bundle — verify by writing (or confirming) a unit test that calls it directly with a
  synthetic `LocalChecksReadings` and asserts the selected commands, not by re-reading the shell
  script's behavior.
- The script-to-test map is derived (not hand-written) and a corpus test
  (`packages/domain/corpus/`) asserts the derivation agrees with the real test files under
  `test/reconcile/*.test.mjs` and `packages/*/test/**` — run it over the current ~75 contract
  files per the plan's open question, and record what you found (agreement, or named gaps).
- `plot-local-checks.mjs` behavior is unchanged from the caller's perspective (same CLI contract)
  — its existing tests still pass unmodified unless the plan's change requires updating them,
  in which case say why in the PR.

Plus the repo's gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` itself before
each push and run what it prints — the suites in the `CI suites` config key run in CI on every
PR; do not run the full e2e/contract suites locally as a matter of course. Since this branch adds
a new rule file, `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .` and
`pnpm --filter @plot-pm/domain exec vitest related --run {changed}` are both in the Local Checks
map for `packages/domain/**` and will be selected for you.

**Shell-line gate:** `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/`
grows past its merge base. If you touch `plot-local-checks.mjs` (a `.sh`-adjacent shell launcher)
to add a call into the new bundle, that growth must be paid for in the same change — prefer
moving logic into the domain rule (already the plan's direction) over adding shell lines.

### Bookkeeping

Open the PR through the controller once there is a real commit:

```bash
../plot/scripts/plot-open-pr.sh          # current branch
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Never `gh pr create` by hand. When the PR exists, append `→ #<number>` to this branch's line
under `## Slices` → `### Selection rule` in the plan file, and push the first real commit as
soon as it exists so the fleet and board see progress.

### Scope guard

This branch owns:
- `packages/domain/src/rules/local-checks.ts` (extend, do not fork)
- `packages/domain/corpus/` — new corpus test for the script-to-test map
- `skills/plot/scripts/board/plot-local-checks.mjs` — the bundle reads the rule; keep its CLI
  contract stable
- Associated unit tests in `packages/domain/test/` and `packages/board/test/` if the bundle's
  shape changes

Out of scope, owned by later waves in this plan:
- `.github/workflows/ci.yml` — wave 2 (`feature/ci-reads-the-selection`)
- The corpus-without-a-token reading — wave 3 (`feature/corpus-reads-without-a-token`)
- The repair-merge exception — wave 4 (`feature/ask-merge-admits-the-repair-pr`), unrelated code
  area entirely (`merge()` / `plot-ask.mjs`)

No other branch is currently dispatched against this plan (it was approved today, 2026-10-30,
as a sprint blocker ahead of the rest of the `delivery-loop` sprint). If you find the domain rule
needs a shape change that wave 2 cannot build on as described, report it rather than guessing
wave 2's needs — leave a clear note in the PR description.

If you find something the plan did not anticipate, report it rather than improvising outside
scope.
