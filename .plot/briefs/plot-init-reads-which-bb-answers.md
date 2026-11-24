## Implementation brief — plot-init-checks-for-the-bb-cli (wave Reading)

- **Plan (canonical):** `docs/plans/2026-11-23-plot-init-checks-for-the-bb-cli.md` on main
- **Approved:** 2026-11-24, jwloka, plan-PR #3699 merged
- **Branch:** `bug/plot-init-reads-which-bb-answers` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

First wave. `bug/plot-init-proposes-the-bb-install` waits on this branch and consumes the state `proposeBbCli` returns; it holds the skill text and nothing else.

### What to build

`/plot-init` on a Bitbucket repository never checks that a usable `bb` exists (issue #2533). `plot-host.sh` refuses a wrong `bb` at its first host call (`bb_identity_check`, `skills/plot/scripts/plot-host.sh:3113`), which is after adoption, on a later command. This branch moves the reading to adoption time, in three layers that already exist for `node`:

1. **Collect.** `skills/plot/scripts/plot-detect-repo.sh` adds two fields to its JSON, only where `git_host` is `bitbucket`: `bb_version_line` (first line of `command bb --version`, empty where none answers) and `bb_paths` (every `bb` on `PATH`, in order, from `type -ap bb`). A version call sends no request. Use `command bb`, as `bb_identity_check` does, and strip ANSI the way `bb_strip_ansi` does.
2. **Decide.** `proposeBbCli` in `packages/domain/src/rules/stack.ts`, modelled on `proposeNode`. It returns `{ state: 'quatico', version }`, `{ state: 'absent' }`, `{ state: 'other', line }` or `{ state: 'shadowed', first, others }`, with the install command (`brew install quatico-solutions/tap/quatico-bb`) on every state that needs one. Add the readings to `StackReadings` and the answer to `StackProposal`/`proposeStack`. `packages/board/src/server/entry/stack-readings.ts` maps probe fields to `StackReadings` (as it does for `node`); extend it.
3. **Report.** `composeAdoption` in `packages/domain/src/rules/adoption.ts` adds a gap line for every state but `quatico`, so `plot-adopt.mjs` names the remedy in its output.

### Settled decisions — do not re-derive

- **The identity test duplicates `bb_identity_check`, deliberately.** Quatico's `bb` prints `bb X.Y.Z` up to 1.12.1 and `bb 1.15.1 (quatico-bb — brew install …)` from 1.13.0; craftamap/bb prints `bb version 0.6.0 (abc1234)`. The shell's test is: the first line contains `\([0-9a-f]+\)`. Do NOT test for the word `quatico-bb` — the 1.12.x line lacks it and would read as `other`. `plot-host.sh` runs the test on every host call, so the shell keeps its copy and the pair joins the corpus tier: `packages/domain/corpus/bb-identity.corpus.test.ts`, a rule-versus-shell comparison in the shape of `sprint-score.corpus.test.ts` (see `packages/domain/corpus/README.md`). A disagreement names both answers and the line; on a disagreement the branch stops and neither side is adjusted to make it pass.
- **No version floor.** `plot-host.sh` keeps none; `BB_LIST_PAGE_VERSIONS` only tunes paging. Report the version, refuse nothing (plan question-minimum-version).
- **A path under `$(brew --prefix)/bin` is the Homebrew one.** The probe reads `brew --prefix` only where `brew` is on `PATH`. Without `brew`, `shadowed` cannot be told: the reading names every path and the state follows from the version line alone (plan question-shadow). Where `brew` is absent the proposal names the formula and the tap and runs nothing (question-no-brew). Where the plan's recommendation leaves a choice, take the recommendation.
- **The probe collects, the domain decides, the shell never decides.** No `case` on the version line in `plot-detect-repo.sh`. This is Manifesto Principle 3 and the layering rule in CLAUDE.md.
- **Absent is not false.** An empty `bb_version_line` on a repository whose `git_host` is not `bitbucket` means *not asked*, not *absent*. Carry the not-asked case through `StackReadings` as a distinct value (as `ciSignals: null` does) so a GitHub repository gets no `bb` gap line. A test must hold this: GitHub adoption output is byte-identical to today.
- **`/plot-board-setup` is out of scope** (question-board-setup): it reuses `proposeBbCli` in a later plan. Do not touch it.
- **No skill text here.** `skills/plot-init/SKILL.md` belongs to the Skill wave.

### Done when

The plan's slice line is the specification. Lift these assertions, each because a naive implementation passes without them:

- `bb 1.15.1 (quatico-bb — brew install quatico-solutions/tap/quatico-bb)` and `bb 1.12.0` answer `quatico` — catches a test on the word `quatico-bb`.
- `bb version 0.6.0 (abc1234)` answers `other` — catches a version-only test.
- An empty line answers `absent`.
- Two paths with a non-Homebrew first answer `shadowed` — catches a rule that reads only the first path.
- A GitHub repository adds no `bb` gap — catches a rule that treats not-asked as absent.
- `bb-identity.corpus.test.ts` runs `bb_identity_check` (source `plot-host.sh`, stub `bb` on `PATH`) against the same lines the rule reads, so a drift fails.
- `adoption.test.ts`: an absent `bb` adds the brew install gap; `plot-adopt.mjs` output carries it. `test/reconcile/init-stack.test.mjs` covers the probe's two fields with a stub `bb` and a stub `brew` on `PATH`.

Plus: the generated bundles under `skills/plot/scripts/board/` are NOT committed (`scripts/check-no-bundle-diff.sh`); `main` builds them. Add a changeset (`'plot': patch`, description first, `bumps:` block last, `plan: docs/plans/2026-11-23-plot-init-checks-for-the-bb-cli.md`; bump `plot-init` as `patch`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base. `plot-detect-repo.sh` gains lines here, so pay for them in the same change: remove shell elsewhere in the same file or another, or move a rule into the domain and ask it through a bundle. Joining statements with `;` or `&&`, or folding `fi`/`done` onto the previous line, is not a payment. The gate stores no number and has no override. Domain code is arrow functions, `export const f = (…) => …`, with factual TSDoc (what it does, parameters, return) and no history.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while moving), never `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

Owned: `skills/plot/scripts/plot-detect-repo.sh`, `packages/domain/src/rules/stack.ts`, `packages/domain/src/rules/adoption.ts`, `packages/board/src/server/entry/stack-readings.ts`, their tests, `packages/domain/corpus/bb-identity.corpus.test.ts`, one changeset, and the `plot-detect-repo.sh` row in `skills/plot/scripts/README.md` only if its description changes. Not owned: `skills/plot-init/SKILL.md` (branch `bug/plot-init-proposes-the-bb-install`, waits on this one), `plot-host.sh` (its `bb_identity_check` stays as is), `plot-board-probe.sh`, `/plot-board-setup`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
