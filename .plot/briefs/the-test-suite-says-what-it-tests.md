## Implementation brief — reconcile-is-a-controller-action (wave 1: Naming)

- **Plan (canonical):** `docs/plans/2026-09-09-reconcile-is-a-controller-action.md` on `main`
- **Approved:** 2026-09-09, Jan Wloka, plan-PR #860 merged
- **Branch:** `infra/the-test-suite-says-what-it-tests` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** PR review per repo convention; Definition of Done gated in CI (`docs/definition-of-done.md`)

This is wave 1 of three and **nothing waits on it.** Waves 2 (`Reconciling`) and 3 (`Sweeping`) build the reconcile rule and the desk finding; neither reads the test script's name. So this branch blocks nobody and is blocked by nobody — it is separated into its own wave precisely because the hang half may not finish, and the rename must be able to land without it.

### What to build

Two things, and the plan is explicit that they land as separable halves of one PR.

**The rename.** `pnpm run test:reconcile` runs 75 files under `test/reconcile/`, of which **7 mention `plot-reconcile-scan`** (measured on this branch's base: `deliverable-search`, `controller-gate`, `fleet`, `host-cli-gate`, `fleetdelivered`, `reaper`, `scan`). The other 68 are contract tests for the whole helper estate — `approve`, `deliver`, `dispatch`, `host`, `board`, `reap`, and seven CI gates that name their own test file in a trailing comment. Both `CLAUDE.md:530` and `AGENTS.md:115` describe all 75 as:

```
pnpm run test:reconcile   # plan-format contract tests (plot-plan-meta.sh)
```

That names one file. The word `reconcile` now means three things in this repo — the controller action the parent plan adds, the `plot-reconcile-scan.sh` sweep, and this suite — and the suite is the one with no claim to it. Rename the script and correct both doc lines to say what the suite covers.

**The hang measurement.** `CHANGELOG.md:2215` records this suite cancelling at the job ceiling in **10 of 16 observed runs**, with no step marked `failure` and `--log-failed` empty, while the same commit passed 912/912 locally in ~7 minutes (measured then, on a smaller suite). `CHANGELOG.md:2368` states the underlying hang is **unexplained**. Measured again 2026-09-09: three processes at **0% CPU for 28 minutes** past a `--test-timeout` of 5, with three agents running the suite concurrently. The deliverable here is a measurement — the condition under which it hangs, or a stated failure to provoke it. Not a fix.

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**The new name is not the sweep's name, and `test:contracts` is the plan's candidate.** The plan's second Open Question asks what it renames to and answers *"`test:contracts` matches what the 74 files are"*, leaving whether CI job names follow to this slice. **Measured: `test:contracts` is free** — the root `package.json` holds `test`, `test:board`, `test:reconcile`, `test:e2e`, and `packages/domain` already uses `test:corpus` for its corpus tier. So the precedent for naming a suite after what it tests rather than where it lives is already in this repo, one package over. The file count in the plan says 74; **it is 75 today** — one file landed after the plan was written. Use the live number in anything you assert.

**The old name is gone, not aliased.** The plan asserts this outright: *"an alias leaves the collision this slice exists to remove."* Keeping `test:reconcile` as a passthrough would satisfy every caller and remove nothing, which is the whole subject.

**Every caller moves together, and the caller list is measured rather than assumed.** On this base:

| caller | what it is |
|---|---|
| `package.json:19` | the script definition |
| `CLAUDE.md:530` | the doc line the plan names |
| `AGENTS.md:115` | the doc line the plan names |
| `.github/workflows/ci.yml:122` | `run: pnpm run test:reconcile`, under `timeout-minutes: 12` |

Those four are the rename. **The directory `test/reconcile/` is a separate question** — the script name and the directory name are two facts, and the plan renames the *suite* (`test:reconcile` is what collides in prose). Renaming 75 files' directory also rewrites the trailing comment in seven `scripts/check-*.sh` gates (`check-bundle-attributes.sh:45`, `check-script-names.sh:75`, `check-state-declarations.sh:84`, `check-host-cli-callers.sh:102` and `:116`, `check-ancestry-decisions.sh:59`, `scripts/bounded.sh:33`) plus `ci.yml:349` and `test/reconcile/workermonitor.test.mjs:673`. Decide it deliberately and say which you did in the PR; a half-done directory rename is worse than either whole answer.

**Do not rewrite the briefs, and there are 261 of them.** `grep` finds `test:reconcile` in **261 of the 432 files under `.plot/briefs/`** — the majority of the corpus. Those are historical hand-off records of what past dispatches were told, and editing them falsifies the record. `CHANGELOG.md` has four references and is likewise a log — `CLAUDE.md`'s own rule applies: *"What you tried, earlier drafts, and review history belong in a log, not in shipped text."* The rename touches shipped text.

**The hang has eight eliminated explanations. Do not re-run them.** `CHANGELOG.md:2215` names them: the branch under test, `/tmp` pollution, leaked processes, a too-short timeout, the server-starting tests, cross-file `pgrep` collisions, contention between runs, and runner slowness. `CHANGELOG.md:2360` adds a ninth: raising `--test-concurrency` is **unsupported** — the reconcile step takes ~2 minutes on a healthy CI run against 12:56 locally at concurrency 1, so the runners are not starved. `--test-timeout=300000` **stays**; that half works and is what turned an anonymous 25-minute cancellation into a named failing test at exactly `300002ms`.

**One asymmetry is measured and unexplored, and it is the honest starting point.** `test:reconcile` is the only test script in the root `package.json` that does **not** run under `scripts/bounded.sh`. `test:board` does (`bounded.sh 1200`). `bounded.sh`'s own header states why that matters and it describes this suite's failure mode exactly:

> `--test-timeout` and vitest's `testTimeout` bound a TEST. Neither bounds a RUN: a suite that hangs between cases, in a `beforeAll`, or during teardown passes every per-test limit and never returns.

CI bounds the step at `timeout-minutes: 12`; **a local run has no outer bound at all.** Applying an existing mechanism to the one suite that lacks it is not a speculative fix — but it bounds the *symptom*, so say so plainly rather than claiming a cause.

**Rules carried over unchanged.** `bounded.sh` exits **124** on a timeout, which is different information from "the tests failed" — a caller reading 124 knows the run did not finish. `timeout(1)` is absent from a stock macOS and `bounded.sh` runs unbounded and says so on stderr rather than pretending; nothing may depend on coreutils being installed. And this repo's own reading of a green suite: a test that is quiet at 0% CPU is not a test that passed.

### Done when

The plan's four asserted properties for this slice are the specification:

1. **No doc describes the suite as plan-format tests.** Both `CLAUDE.md:530` and `AGENTS.md:115` name what the suite actually covers.
2. **Every caller moves together** — `package.json`, both docs, and the CI reference — so a stale name cannot survive in one place.
3. **The old name is gone rather than aliased.**
4. **The hang is reproduced, or the slice says it could not be.** A stated failure to provoke it is a valid deliverable; a speculative fix is not.
5. **No test file is edited to make the suite pass.** The plan forbids this outright: *"a green suite bought by weakening an assertion is the one move this repo forbids."* If contention is the cause, the repair is bounding concurrency.

Assertions worth writing because a naive rename passes without them:

- **Grep the whole repo for the old script name after the change** and account for every remaining hit as either a log (`CHANGELOG.md`, `.plot/briefs/`) or a defect. A rename verified only by "CI is green" passes while a doc still names the dead script — CI does not read prose.
- **Run the renamed script.** A `package.json` key rename with a typo in the glob exits 0 having run **zero** files, and `node --test` over an empty glob is silent success. Check the test count, not the exit code. Take the baseline yourself before renaming; `CHANGELOG.md:2217` records 912/912 in ~7 minutes, but that was measured at PR #562 against a smaller suite, so it is the shape of the check rather than today's number.

Plus the repo's gates: `nvm use` first (**Node 24 — pnpm crashes on 26**, and a background job under 26 exits silently having produced nothing, which reads exactly like a hang). Then `pnpm install`, `pnpm test` (skill parsing), the renamed contract suite, and `pnpm run typecheck`. **Do not run `pnpm run test:e2e`** — it is CI's gate, it dispatches real workers, and two concurrent local runs took this machine to load average 8.69.

A changeset is required, with the **description FIRST and the `bumps:` block LAST** — a `bumps:` block written first becomes the published release note and the description never ships. A `plan:` line naming this plan is optional and welcome, and obeys the same order rule. Run `./scripts/check-changeset-packages.sh` locally; the package name must be `plot` or `@plot-pm/board`.

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while the hang half is still moving
```

It takes the title from the wave heading the plan names this branch under (`Naming`), not from `git log -1`. Measured 2026-09-08: three slice PRs opened by hand each took their title from the last commit subject, which on this estate is routinely `plot: build the board artifact`.

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`. Push the first real commit as soon as it exists.

**Separate the two halves in the PR** — the plan asks for this explicitly, so the trivial rename can land regardless of whether the hang yields. Distinct commits at minimum; say in the PR body which half is which and what the hang measurement concluded.

### Scope guard

This branch owns: `package.json` (the script line), `CLAUDE.md:530`, `AGENTS.md:115`, `.github/workflows/ci.yml:122`, and — if you take the directory rename — `test/reconcile/` plus the seven `scripts/check-*.sh` comment references and `ci.yml:349`.

**Measured at dispatch, not guessed:** five other branches are live on the remote (`bug/a-plan-row-shows-its-phase`, `feature/adoption-proposes-the-ticket-prefixes`, `feature/an-adopting-repo-installs-its-gates`, `feature/an-installed-gate-fires-once`, `feature/the-jira-jql-scopes-by-project`). **None of them touches `package.json`, `CLAUDE.md`, `AGENTS.md`, `ci.yml`, or `test/reconcile/`** — checked with `git diff --name-only origin/main...origin/<branch>` against all five. Two of them add CI gates, so `ci.yml` is the plausible future collision if they advance; re-check before merging rather than trusting this line.

The sibling waves in this plan (`feature/reconcile-is-a-controller-action`, `feature/a-finished-desk-is-a-finding`) do not exist yet and do not read the script name.

Out of scope: the reconcile controller action itself, `plot-reconcile-scan.sh`, `reap.ts`, and the `isDispatchTree` field — those are waves 2 and 3.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
