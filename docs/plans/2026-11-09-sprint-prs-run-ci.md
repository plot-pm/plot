# Sprint PRs run CI

> `.github/workflows/ci.yml` runs on pull requests into `sprint/**` as well as into `main`, so every slice PR into a sprint branch runs CI, and the merge-base gates compare a slice with its sprint branch, not with `main`.

## Status

- **State:** Delivered
- **Type:** infra
- **Sprint:** desk-probes-and-liveness
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-09, jwloka, plan-PR #3308 merged
- **Delivered:** 2026-11-09

## Changelog

- A pull request into a sprint branch runs the same CI as a pull request into `main`, the process census included where the change selects it. A slice that breaks a gate or a test shows red on its own PR, before the sprint PR.
- fleetd reviews a green slice PR into a sprint branch and starts a fixer on a red one, as it does for a pull request into `main`.
- The shell-line, decision-count, bundle-diff and sprint-member gates compare a pull request with the branch it targets.

Board impact: none on the plan format, the template, the helper scripts or the `docs/plans` layout. A slice PR into a sprint branch now carries a check rollup, so the board shows its CI state where it showed `none`.

## Motivation

`ci.yml:3-5` starts a `pull_request` run only for base `main`. A slice PR into a sprint branch starts no run, and the first CI run that sees a slice's change is the sprint PR into `main`. In sprint `the-board-reads-the-channel` (15 slices), five defects reached the sprint PR #3277 that the slice PRs would have shown:

| Defect | Found on | Fixed by |
|---|---|---|
| the domain vendor gate | sprint PR #3277 | #3301 (`Vendor gate`, into `sprint/the-board-reads-the-channel`) |
| the actor-name and teardown gates | sprint PR #3277 | #3301 |
| a config reading recorded by reference, and two heartbeat test timeouts | sprint PR #3277 | #3303 (`Main merge`) |
| a stale usage-line test | sprint PR #3277 | #3303 |
| a corpus vacuity row after a reconcile edit | run 42602121182 on #3277 | — |

Each fix cost a push to the sprint PR and a full run of about 25 minutes, after the slice's agent had ended. The story records the same finding (*Session Log*, 2026-11-09: "PRs into a sprint branch run no CI, so four defects reached the sprint PR"), and `quality-gates-fail-fast` noted the trigger in its *Notes*.

The fleet reads the missing run too. A slice PR into a sprint branch has an empty check rollup, so its row reads `ciChecks: none`. `reviewArm` starts a review only on `ciChecks: green` (`packages/domain/src/rules/slice-pr-next.ts:316-317`), and `ciRedArm` starts a fixer only on `failing` (`:292-293`). Neither arm can act on a sprint slice today.

## Design

This plan has no `Story:`; it serves every sprint. It touches the `on:` block of `ci.yml`, and the open plan `ci-cancels-superseded-runs` (PR #3305, `docs/plans/2026-11-09-ci-cancels-superseded-runs.md` on `origin/idea/ci-cancels-superseded-runs`) touches the `concurrency:` block below it (`ci.yml:57-68`) and the rows of `test/reconcile/release-pr-ci.test.mjs` that hold it (`:134`, `:152`).

**Merge order: `ci-cancels-superseded-runs` first.** Its group keys a `pull_request` run on the pull request number, so a slice PR's runs then share one group per PR and a new push cancels the older run. This plan then changes no `concurrency:` expression; it adds one contract row that a `pull_request` run into a sprint branch gets the same per-PR group. If this plan merges first, every slice push keeps its own group (`github.run_id`) and is never cancelled, and agents that push several times per slice hold runners for runs nobody reads until the second plan lands. Neither order breaks a test; the second to merge rebases its `ci.yml` and `release-pr-ci.test.mjs` hunks.

`ci-reuses-green-runs` (this batch) also edits `ci.yml` (its `select` job, the `if:` of the reusable jobs and `validate`) and `test/reconcile/ci-tiers.test.mjs`. The edited lines differ, so the second to merge rebases and neither order breaks a test; this plan changes the `on:` block and the gate steps, and `ci-reuses-green-runs` reads the sprint base this plan introduces (its *With `sprint-prs-run-ci`* paragraph). Merge order: `ci-cancels-superseded-runs`, then this plan, then `ci-reuses-green-runs`.

It shares no other file with `refs-from-files`, `one-cat-file-batch`, `desk-probes-in-domain`, `node-worker-wrapper`, `liveness-token` or `github-reads-in-process`. Every slice of those plans that targets a sprint branch gets CI from this plan.

### Approach

**What already works for a sprint base.** These parts of `ci.yml` key on the PR's own base or on the merge commit, so they need no change:

- `select` diffs `HEAD^1 HEAD` on the PR's merge commit (`ci.yml:175`). For a slice PR the first parent is the sprint branch, so the selection reads the slice's own change. The comment at `ci.yml:142-143` says "the current `main`" and changes to "the base branch".
- `census-base` compares with `git merge-base HEAD origin/$BASE_REF`, where `BASE_REF` is `github.base_ref` (`ci.yml:819`, `:827-829`). For a slice PR that is the sprint branch.
- Every step gated on `github.event_name == 'pull_request'` (`ci.yml:147-171`, `:1382`, `:1394`, `:2143`, `:2552`) runs for both bases.
- The release-PR refusals in each job's first step (`ci.yml:121-127` and the copies in every job) apply only to `workflow_dispatch`, and the release PR's base is `main`.
- The corpus job fetches `main` because the scan reads approvals from `origin/main` (`ci.yml:336-340`). That is the scan's question, not the PR's base, and it stays.

**What keys on `main` and must read the PR's base.** Four gates take their merge base from `main`. On a slice PR that base is the commit the sprint branch was cut from, so the gate measures the whole sprint, and a slice is refused for lines or bundles another slice added:

| Gate | Where the base is fixed | Change |
|---|---|---|
| `check-shell-lines.sh pr` | `default_ref`, `scripts/check-shell-lines.sh:87-91`, used at `:136-138` | `pr [<base ref>]`; with no argument, `default_ref` as today |
| `check-decision-count.sh pr` | `default_ref`, `scripts/check-decision-count.sh:72-76` | the same optional argument |
| `check-no-bundle-diff.sh` | `BASE_REF="${3:-origin/main}"`, `scripts/check-no-bundle-diff.sh:61` | CI passes `origin/$GITHUB_BASE_REF` as the third argument |
| `check-sprint-members.sh` | `merge-base origin/main HEAD`, `scripts/check-sprint-members.sh:8` | an optional first argument, the base ref |

In `ci.yml`, the step "Fetch the default branch the shell count reads" (`:1587-1588`) fetches `origin/$GITHUB_BASE_REF` on a pull request and `main` otherwise, and the steps at `:1383`, `:1394`, `:1595` and `:1603` pass `origin/$GITHUB_BASE_REF` on `pull_request` only. The steps at `:1595` and `:1603` also run on `workflow_dispatch`, where `GITHUB_BASE_REF` is empty; there each step passes no argument and keeps today's default (`default_ref`, which resolves to `origin/main`). The local default does not change, so `plot-local-checks.mjs` and the `Local checks` key keep running the gates with no argument. The gate fixture tests (`test/reconcile/shell-lines.test.mjs`, `decision-count.test.mjs`, `no-bundle-diff-gate.test.mjs`) gain a row each: a branch cut from a feature branch, compared with that branch, counts only its own lines.

**The trigger.** `on.pull_request.branches` becomes `[main, 'sprint/**']`. `on.push` stays `[main]`: a direct push to a sprint branch (a booking commit, a sprint close) starts no run, and the sprint PR into `main` keeps the full run. A contract row in `test/reconcile/release-pr-ci.test.mjs` holds both lists, beside the existing row that holds `push` at `[main]` (`:97-105`). No row asserts the `pull_request` list today: `ci-selection-jobs.test.mjs` and `ci-tiers.test.mjs` read jobs, not triggers.

**The census on a slice PR.** The census is selection-gated: `census-head` and `census-base` run when a change selects `packages/board`, `packages/domain` or `packages/fleet` (`ci.yml:98`). A run costs about 12.5 minutes on two runners (story, *Session Log*, 2026-11-09). Slice PRs run it under the same selection, and no step skips it when `github.base_ref` is not `main`, so a slice that adds processes shows it on its own PR: Phase 5 and Phase 6 of `nothing-changed-nothing-runs` each claim a census count, and one sprint PR cannot say which slice moved it. With `ci-cancels-superseded-runs` merged first, a superseded census run is cancelled.

**The fleet's arms.** With a run, a slice PR's row carries `ciChecks`. `reviewArm` can start a review on a green slice PR and `ciRedArm` can start a fixer on a red one, inside the scope `guardArm` already applies (`slice-pr-next.ts:159-167`). This plan changes no rule; it gives the rules a reading. Both arms act on sprint slices: a green slice PR spends the review budget and a red one the fixer bound, where nothing reached them before, because a review per slice costs less than a fix on the sprint PR.

**`validate` becomes required on `sprint/**` by hand.** This plan starts the run and adds no file that requires it: a ruleset is a repository setting. After the first sprint runs green on its slice PRs, a person adds a ruleset that requires `validate` on `sprint/**` and records the date in this plan's *Notes*.

### Open Questions

- [x] **The census on slice PRs.** Run it under the selection, as for a PR into `main` (about 12.5 minutes on two runners per selected push), or skip it when `github.base_ref` is not `main` and leave the measurement to the sprint PR. Recommendation: run it. The sprint plans of Phases 5 to 8 each claim a census count, and one sprint PR cannot say which slice moved it. With `ci-cancels-superseded-runs` merged first, a superseded census run is cancelled. A person decides. **Decided 2026-11-09, jwloka: slice PRs run the census under the selection.**
- [x] **A required check on sprint branches.** This plan starts the run; it does not make `validate` required on `sprint/**`. A ruleset that requires it would stop a red slice from merging into the sprint branch, and it is a repository setting, not a file in this repository. Recommendation: add the ruleset by hand after the first sprint runs green on slice PRs, and record the date in this plan's *Notes*. A person decides. **Decided 2026-11-09, jwloka: `validate` becomes required on `sprint/**` by a hand-added ruleset after the first green sprint; the date goes into *Notes* then.**
- [x] **Reviews and fixers on sprint slices.** A green slice PR becomes eligible for `reviewArm`, and a red one for `ciRedArm`, which spend the review budget and the fixer bound on sprint slices where nothing reached them before. Is that the intended behaviour, or should a sprint slice wait for the sprint PR's review? Recommendation: let both arms act; a review per slice is cheaper than a fix on the sprint PR. A person decides. **Decided 2026-11-09, jwloka: fleetd's review arm and red-CI fixer act on sprint slices.**

## Done when

| Claim | Check | Slice |
|---|---|---|
| A gate compares a slice with its sprint branch | a fixture row in each of `shell-lines.test.mjs`, `decision-count.test.mjs` and `no-bundle-diff-gate.test.mjs`: a branch cut from a feature branch and compared with it counts only its own change | Gate base |
| The gates keep their local default | the same tests: with no base argument, each gate compares with `origin/<default>` as before | Gate base |
| `check-sprint-members.sh` takes a base | a new fixture test `test/reconcile/sprint-members-gate.test.mjs`: a branch cut from a feature branch and compared with it counts only its own member lines; with no argument the script compares with `merge-base origin/main HEAD` as before | Gate base |
| CI passes the PR's base to the gates | the gate steps in `ci.yml` pass `origin/$GITHUB_BASE_REF` on `pull_request`; `ci-tiers.test.mjs` refuses a copy that passes `origin/main` | Gate base |
| A slice PR into a sprint branch starts a run | `release-pr-ci.test.mjs`: `on.pull_request.branches` lists `main` and `sprint/**`; `on.push.branches` stays `[main]` | Trigger |
| A slice PR's run shares its PR's group | `release-pr-ci.test.mjs`: a `pull_request` run into `sprint/**` gets the per-PR group of `ci-cancels-superseded-runs` | Trigger |
| The census runs on a slice PR | `ci-selection-jobs.test.mjs`: a `pull_request` into `sprint/x` that selects `packages/fleet` selects `census-head` and `census-base`, and no census step tests `github.base_ref` against `main` | Trigger |
| The fleet's arms act on a sprint slice | a `slicePrNext` row: an open slice PR into `sprint/x` with `ciChecks: green` selects `reviewArm`, and one with `failing` selects `ciRedArm` | Trigger |
| The first sprint after merge shows red on the slice | the slice's own PR shows a run on a PR into a `sprint/` branch, with `validate` reported | Trigger |

## Slices

### Gate base

- `infra/sprint-prs-gate-base` — the optional base argument for `check-shell-lines.sh pr`, `check-decision-count.sh pr` and `check-sprint-members.sh`, the third argument to `check-no-bundle-diff.sh` in CI, the fetch of `origin/$GITHUB_BASE_REF`, and the fixture rows <!-- builds: the merge-base gates read the pull request's base --> → #3312

### Trigger

- `infra/sprint-prs-run-ci` — `on.pull_request.branches: [main, 'sprint/**']`, the comment at `ci.yml:142-143`, and the trigger and group rows in `release-pr-ci.test.mjs`; merges after `infra/ci-cancels-superseded-runs` <!-- builds: CI runs on pull requests into sprint branches --> → #3313

## Notes

- Measurements from sprint `the-board-reads-the-channel` and its sprint PR #3277 on 2026-11-09. #3301 and #3303 are merged into `sprint/the-board-reads-the-channel`.
- Line numbers checked in the worktree of `idea/batch-refs-from-files` (cut from `origin/sprint/the-board-reads-the-channel` at `11a270538`) on 2026-11-09.
- The *Gate base* slice ships first and changes no run on its own: until the trigger lands, every pull request targets `main`, and `origin/$GITHUB_BASE_REF` is `origin/main`.
- `validate` required on `sprint/**`: not yet. A person adds the ruleset by hand after the first green sprint on slice PRs and records the date here.
- Deliverable search (`plot-deliverable-search.sh`) for "sprint PR CI", "pull_request sprint", "slice PRs run CI" and "check-shell-lines base" found no existing deliverable.
- Definition of Done: docs/definition-of-done.md.
