## Implementation brief — reports-name-their-cause-and-ci-selects-their-tests (slice: Plan paths)

- **Plan (canonical):** docs/plans/2026-11-21-reports-name-their-cause-and-ci-selects-their-tests.md on main
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3611 merged
- **Branch:** `bug/a-plan-pr-runs-the-estate-tests` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review through the repo's review channel (`Review: pr`)

The five slices are independent and no slice waits on another. This one fixes the plan-path half of #3149. Slice 5 (`bug/an-entry-source-selects-its-bundle-tests`) edits the same rule file, `packages/domain/src/rules/local-checks.ts`, and its tests — see the scope guard.

### What to build

A pull request that changes a plan file runs no test that reads the plan estate. `node skills/plot/scripts/board/plot-local-checks.mjs --ci --files docs/plans/2026-11-21-x.md` answers `"tests":[]` and `"corpus":true`. The estate tests "plan-meta: the anchor drops no real claim across the whole estate (differential)" (`test/reconcile/parser.test.mjs:1511`) and "plan-meta: every plan in docs/plans gives the measured count — 0" (`:3013`) read every plan file and do not run. On 2026-11-04 plan PRs #3114 and #3127 passed CI and turned `main` red from `fbf670eaf`; `default-branch-red` held every slice merge for about 13 hours. Four changes fix this:

1. **A marker.** A test file holds the line `// plot-reads: <dir>`, where `<dir>` is a `corpusGlobs` directory such as `docs/plans`. The rule reads the directory from the `Plan directory` and `Sprint directory` values it already takes (`corpusGlobs`, `local-checks.ts:306`), so it holds no project path.
2. **One domain function for both callers.** `estateReaders(changed, corpusGlobs, tests)` in `packages/domain/src/rules/local-checks.ts` answers, for each changed path under a `corpusGlobs` directory, the test files that carry the marker for that directory. `ciSelection` and `localChecks` both call it. `localChecks` also drops plan data from its basename references, as `ciSelection` does (`:440-442`), so both select the same files for a plan path. The entry stops building basename references for plan data (`packages/board/src/server/entry/local-checks.ts:282-285`). The answer lists the selected files in a field of its own, `estateTests`.
3. **The limit does not apply.** The tests `estateReaders` selects are exempt from `DEFAULT_LOCAL_CHECKS_LIMIT` (20, `:62`; applied at `:333-335`). `overLimit` does not read `estateTests`. Basename references keep the limit.
4. **A gate and the job map.** `scripts/check-estate-readers.sh` fails on a `test/reconcile/*.test.mjs` file that passes the `Plan directory` or `Sprint directory` to `readdirSync` and carries no `// plot-reads:` line for it. Its contract test is `test/reconcile/estate-readers-gate.test.mjs`. `scripts/ci-job-map.jq` reads `estateTests` apart from `.checks[].tests`: they set `contracts` and join `contracts_tests`, and they do not set `e2e`. Add the marker to the estate readers: `test/reconcile/parser.test.mjs` (`:1511`, `:3013`, and the readers at `:2640`, `:2769`) and every other file the gate names.

The plan is canonical. This brief is orientation.

### Settled decisions — do not re-derive them

- **Moving the two estate tests into the corpus tier is rejected.** It fixes only the two tests that broke `main` on 2026-11-04. Measured: 22 `test/reconcile` files hold both `readdirSync` and a plan path, and the corpus tier is vitest over the domain while these tests drive shell scripts through `node --test`. The marker plus the gate covers every present and future estate reader, which is the omission #3149 reports.
- **The marker is a declaration, not an inference from text.** That is why its tests are exempt from the limit of 20. Do not infer estate readers by grepping test bodies in the rule: the gate does the grep, once, and the rule reads only the marker.
- **The job map must not start e2e for a plan PR.** `ci-job-map.jq` sets `e2e` from `$contract` (`:16`, `:26`), so a selected `test/reconcile` file starts the e2e job today. With the marker alone, every plan PR would start e2e — real workers in sandbox repositories, 5 to 10 minutes — and `Plan PRs: required` sends every plan through one. Read `estateTests` into `contracts` and `contracts_tests` only. A plan-only answer then sets `corpus` and `contracts`, lists the estate files in `contracts_tests`, and leaves `e2e` false.
- **A plan path selects no test that only names its basename.** `ciSelection` already treats a path under `corpusGlobs` as plan data and selects no other check for it (`:453-470`). `localChecks` took a precomputed `references` map built over every changed path, plan files included, so the local run and CI disagreed on a plan path. After this slice they answer the same `estateTests` for one input.
- **A `docs/sprints` marker is not selected by a plan path.** The marker names its directory, and the match is per directory.
- **The domain keeps its purity gate.** `local-checks.ts` takes readings as values and imports `zod` and nothing else. Write new functions as arrows (`export const f = (…) => …`). TSDoc states what an export does, its parameters, its return and its failure, with no decision history. The reasoning belongs in the commit message.
- **Absent is not false.** A test list the entry could not read must not read as "no estate readers". Keep whatever unread handling `readTests` has today.
- **`helper-contracts` time.** One run took 15 minutes on 2026-11-21 (05:57–06:12Z) for the full suite. A run of the estate files only is shorter. Record the time of your run in the PR description.

### Done when

The plan's slice-4 test list is the specification:

- `packages/domain/test/local-checks.test.ts`:
  - a changed `docs/plans/x.md` selects a test with `// plot-reads: docs/plans` and not one without;
  - a `// plot-reads: docs/sprints` test is not selected by a plan path;
  - a plan path selects no test that only names its basename, in `localChecks` and in `ciSelection`;
  - 25 marked tests are all selected and none is reported in `overLimit` — this catches an implementation that merges estate tests into the limited list;
  - `localChecks` and `ciSelection` answer the same `estateTests` for one input — this catches the disagreement #3149 reports.
- `test/reconcile/ci-selection-jobs.test.mjs`: the mapping test names the `docs/plans/**` entry. A plan-only answer with `estateTests` sets `corpus` and `contracts`, puts the estate files in `contracts_tests`, and leaves `e2e` false — this catches a map that starts e2e for every plan PR.
- `test/reconcile/estate-readers-gate.test.mjs`: the gate fails on a fixture file that walks the plan directory with no marker, and passes with the marker.
- After the markers are added, run `./scripts/check-estate-readers.sh` on the repo itself: it must pass, and it must name no file you did not mark.

Plus the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run no full suite, and not `test:e2e`.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. `scripts/check-estate-readers.sh` sits outside `skills/`, so it does not count. If the slice touches a `.sh` file under `skills/`, pay for the growth in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines, so joining statements with `;` or `&&` pays nothing. The gate stores no number and has no override.

A new script under `scripts/` needs its CI wiring: add the gate to the `Local checks` config's gate list if the repo keeps one, and to CI beside the other `scripts/check-*.sh` gates. Check `scripts/check-helper-table.sh` for whether it requires a README row.

Changesets: this slice changes packages (`'@plot-pm/board'`). Put the description first and the `bumps:` block last. Run `./scripts/check-changeset-packages.sh`. Run `pnpm build:board` only to test locally, and commit no bundle (`scripts/check-no-bundle-diff.sh`).

### Bookkeeping

- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.
- Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/local-checks.ts` (the `estateReaders` function, the `estateTests` field and the `localChecks` reference change), `packages/board/src/server/entry/local-checks.ts` (lines `:282-285` and the pass-through of `estateTests`), `scripts/ci-job-map.jq`, `scripts/check-estate-readers.sh`, the `// plot-reads:` lines in `test/reconcile/*.test.mjs`, and the tests named above.

Slice 5, `bug/an-entry-source-selects-its-bundle-tests`, also edits `packages/domain/src/rules/local-checks.ts`, `packages/domain/test/local-checks.test.ts` and `packages/board/src/server/entry/local-checks.ts` (the `bundles` reading). Expect a textual merge conflict in those three files whichever slice merges second, and resolve it by keeping both changes: the two add separate parameters and fields. The other slices touch none of this slice's files: `release-chain.ts`, `plot-host.sh` and `host.test.mjs`, `plot-desk-dirt.sh`, `reap.ts`, `build.mjs`. Verify with `git diff --stat origin/main...origin/<branch>` for each open `bug/*` branch before you push.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
