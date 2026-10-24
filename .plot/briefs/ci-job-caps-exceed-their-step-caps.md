## Implementation brief — ci-job-caps-and-the-apt (wave 1: Caps and gate order)

- **Plan (canonical):** docs/plans/2026-10-24-ci-job-caps-and-the-apt.md on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2534 merged
- **Branch:** `infra/ci-job-caps-exceed-their-step-caps` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** pull request; plot-review is a required context on `main`

This is wave 1 of 3. Slice 2 (`infra/the-apt-cache-key-follows-the-package-set`) edits other jobs of the same `ci.yml` and rebases over this one if it merges second. Slice 3 (`infra/ci-comments-state-current-behaviour`) edits comments in the same file; neither waits on this branch, and this branch waits on neither.

### What to build

Two edits to `.github/workflows/ci.yml` and one measurement, all from issue #2485.

**A wedge hides its own diagnostic.** `helper-contracts` has `timeout-minutes: 12` (`ci.yml:207`) and its test step `Helper contract tests` also has `timeout-minutes: 12` (`ci.yml:308`). When the step cap fires, the job cap fires in the same moment, the job ends `cancelled`, and the `if: failure()` step `What was still running (only when the suite wedged)` (`ci.yml:310`) never runs. That step exists for exactly this wedge. The fix: the job cap becomes the step cap plus a margin that covers checkout, setup and the diagnostic step. The step caps stay.

**One failure hides the others.** `Require the split jobs` is the first `validate` step (`ci.yml:574`). A failing split job ends `validate` at that step, so no other `validate` gate reports in that run. The fix: move it to the last `validate` step so the split-job failure is the final line.

**One claim has no measurement.** The comment at `ci.yml:532` says a cancelled run still reads `cancelled` when `validate` waits on `needs` with `if: !cancelled()` (`ci.yml:534` on the plan's base). Nothing tests it. This slice measures it; the form is an open question below.

The plan is canonical; this brief is orientation. Line numbers come from `84b1638e4`. `ci.yml` has no commit since then (checked 2026-10-24 on `origin/main` `60971d871`), so they hold today, but re-measure each line before you edit it.

### Settled decisions — do not re-derive them

**The step caps stay.** The plan keeps each step's `timeout-minutes` and changes only the job caps. Lowering a step cap would move the wedge earlier and measure nothing new.

**The sum of step caps is not 20 for `board-integration`.** Its step caps are 10 (`Cache the Playwright browser`, `:390`) + 10 (`Cache Playwright's apt packages`, `:421`) + 7 (`Install Playwright system packages`, `:465`) + 5 (`Install Playwright browser`, `:504`, cache miss only) + 15 (`Board integration tests`, `:519`) = 47 minutes, against a job cap of 20 (`:337`). The comment at `:336` already computes 15.75 minutes on a cache hit and 20.75 on a miss, and the 20 sits below its own worst case. So "sum plus margin" does not apply mechanically to this job: either the cap rises above 20.75, or the step caps shrink so their sum fits. The plan's first open question names both. Do not set the cap to 47 + margin without saying why 47 is the right bound; a cap that long turns a wedge into a 50-minute silence, the thing the `validate` cap comment measured on 2026-08-19 (eleven hung runs, 10 to 57 minutes each).

**The margin comes from a measurement, not a round number.** Read the checkout and setup durations from the last 30 `helper-contracts` and `board-integration` runs and set the margin from the p95. The existing measurements to build on: `helper-contracts` p95 547.6 s, max 554 s; `board-integration` median 542.5 s, p95 600 s, max 606 s (comments at `:204` and `:331`). Record the new figures in the comment beside the cap, with the date and run count, in the style of the existing ones.

**`Require the split jobs` keeps `if: !cancelled()` and needs it on the step.** `validate` is `if: ${{ !cancelled() }}` at job level (`:534`), but a step after a failing step is skipped unless it carries its own condition. Moved to the last position, the step needs `if: ${{ !cancelled() }}` itself, or it never runs after any earlier gate fails. That is the naive-implementation trap: the move looks like a cut-and-paste, passes on a green run, and silently stops requiring the split jobs after any earlier `validate` failure. Check both shapes: a red split job with every other gate green must read `failure`, and a red split job with an earlier gate also red must still run the step and name the split job.

**The step comment moves with it.** The comment at `:570` says "FIRST STEP" and says the step "checks nothing out, so it runs safely ahead of the dispatch guard"; the comment at `:532` says "its first step exits 1". Both state the old position. Rewrite them in the present tense for the new one. The `Guard the dispatched run` step stays ahead of any checkout.

**Carried rules from this estate.** `needs:` alone does not fail the job (a skipped required check passes the ruleset, measured 2026-10-20, ruleset 24412719), so the `Require the split jobs` step stays and `validate` stays a required context. A cancelled run must still read `cancelled`, not `failure`. Both are the reason for the claim measured below.

### Open questions — answer them in the PR description

- **Job cap margin.** Described above; read it from the last 30 runs.
- **How to measure the cancelled-run claim.** (a) a workflow-dispatch run that cancels itself and asserts the `validate` result, which adds a CI job, or (b) a recorded run id cited in the comment, which adds no gate and states a fact once. Pick one and say why. If (a), the job needs its own `timeout-minutes` and a dispatch guard consistent with the other jobs' `Guard the dispatched run` step; if (b), cite a real run id whose `validate` job you read with `gh run view`, not one you remember.

### Done when

The plan's `## Slices` entry for this branch is the specification: job caps exceed their step caps, `Require the split jobs` runs last, the cancelled-run claim is measured. In terms a reviewer can check:

- `helper-contracts` job `timeout-minutes` is greater than its test step's by a margin cited from a measurement, and the diagnostic step is reachable after the step cap fires. Catches: the 12/12 equality that ended the job before the step ran.
- `board-integration`'s job cap is above its stated worst case, or its step caps sum to no more than its job cap. Catches: the 20 below its own 20.75 minute figure.
- `Require the split jobs` is the last step of `validate` and carries its own `if: ${{ !cancelled() }}`. Catches: the step silently skipped after an earlier gate fails.
- The comment at `:532` and `:570` describe the new position. Catches: "FIRST STEP" left above a last step.
- The cancelled-run claim has a measurement a reader can follow.

Plus: this branch edits no generated bundle, so `scripts/check-no-bundle-diff.sh` stays clean. A workflow change needs a changeset only if CI treats `.github/` as shipped; check `scripts/check-changeset-packages.sh` and the neighbouring `infra/` PRs rather than guessing, and use the description-first, `bumps:`-last order from `CLAUDE.md` if one is needed. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite. Run `actionlint` on the workflow if it is installed.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches no `.sh` file under `skills/`; if a `run:` block in `ci.yml` grows, that is YAML, not counted there.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `.github/workflows/ci.yml`, in the `helper-contracts`, `board-integration` (cap only) and `validate` jobs, plus the comments that describe those. Do not edit:

- the apt-cache steps (`Cache Playwright's apt packages`, the stage step, the Playwright version step) — slice 2;
- the comments at `ci.yml:232`, `:336`, `:406`, `:409`, `:413`, `:416`, `:552`, `checks-verdict.ts:174`, `bounded-run-group-stop.test.ts:23`, `check-helper-table.sh:131` and `plot-host.sh:4844` — slice 3. The one exception: the comment at `:336` states the 20.75 worst case that this branch's cap must exceed. If you change the cap, update that comment in the same diff and tell slice 3's author in the PR.

Other branches in flight on `main` that touch `ci.yml`: none open at dispatch (`git log 84b1638e4..origin/main -- .github/workflows/ci.yml` is empty). If you find something the plan did not anticipate, report it rather than improvising outside scope. If a finding no longer holds on `origin/main`, record that in the plan's Notes, as the plan says.
