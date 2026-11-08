# Quality gates fail fast

> CI runs its checks cheapest first, a failed cheap tier skips the expensive jobs still waiting, the process census runs its HEAD and merge-base halves in parallel jobs, every long job states its cap, and `plot-local-checks.mjs` prints and runs its commands cheapest first against the branch's own base.

## Status

- **State:** Draft
- **Type:** infra
- **Sprint:** the-board-reads-the-channel
- **Review:** pr
- **Impl:** own branches

## Changelog

- CI runs the static gates first, in their own job. A failed gate skips the suites and the process census that wait on it, so a red pull request reports in minutes, not after the census.
- The process census runs its HEAD half and its merge-base half as two parallel jobs and compares their reports in a third.
- `plot-local-checks.mjs` prints its commands cheapest first, runs them with `--run` until the first failure, and reads a sprint slice's changes against its sprint branch with `--base`.

Board impact: none on the plan format, the template or `docs/plans`. The `checks` job and the census job change names and edges; `validate` keeps its name and stays the one required check, so the board's CI reading (`checks-verdict.ts`) reads the same run shape.

## Motivation

CI on sprint PR #3237 on 2026-11-08 took 26 to 45 minutes per push, and most of that time came after the result was already known:

| Head | Outcome | `checks` done | suites/`validate` done | `process-census` done |
|---|---|---|---|---|
| d1117a0a8 | `checks` failed | ~6 min | ~13 min | ~26 min (ran on after `checks` failed) |
| 007f1e427 | green, census red | ~8 min | ~12 min | ~35 min |
| a269f54d6 | all green | — | ~12 min | ~33 min |
| 8437242ef | docs-only change since a269f54d6 | — | ~12 min | ~45 min |

Four facts in `.github/workflows/ci.yml` produce these numbers:

- Every job after `select` starts at once. `corpus`, `macos-shell-contract`, `process-census`, `helper-contracts`, `board-integration` and `checks` each say `needs: select` and `if: ${{ !cancelled() && … }}` (`ci.yml:266-267`, `:421-422`, `:552-553`, `:675-676`, `:839-840`, `:1087-1088`). No job waits on a cheaper one, and `!cancelled()` runs a job even when a job it needs failed.
- The cheap static gates sit inside `checks` beside the unit tests and e2e: `Plan headings say Slices` (`:1808`), the domain, board and fleet typechecks (`:2176`, `:2190`, `:2224`), the gate tests (`:1201`) and `E2E choreography tests` (`:1212`) share one job with a 25-minute cap (`:1114`).
- `process-census` runs both trees in one step: `census-gate.mjs` runs the census against HEAD (`packages/fleet/test/census/census-gate.mjs:64`), then adds a worktree at the merge base and runs it again (`:69`), also when HEAD's census failed. The step comment measures the HEAD half at 830 s (`ci.yml:634-639`).
- The run-level `concurrency` group is `github.run_id` for every non-dispatched run (`ci.yml:66-68`), so a failure cancels nothing.

Locally, `plot-local-checks.mjs` prints its commands in the declaration order of the `Local checks` key (`packages/domain/src/rules/local-checks.ts:345`), and this repository declares the 21 `scripts/check-*.sh` gates last (`CLAUDE.md:56`). It reads changes against the default branch (`packages/board/src/server/entry/local-checks.ts:209`, which calls `changedFiles('HEAD')` with no `against`; `refs-git.ts:508-509` then resolves `origin/HEAD`). On sprint `nothing-runs` every slice agent therefore got the whole sprint diff — 40 to 60 test files and the domain, board and fleet suites — and skipped checks by hand. The fleet's runner already stops at the first failed command (`packages/fleet/src/server/entry/worker-loop.ts:1433-1436`), so the order it receives decides how soon a cheap failure surfaces.

## Design

### Approach

**The tiers.** Every CI job belongs to one tier, and a job in a later tier `needs:` the tier before it:

| Tier | Job | Contents |
|---|---|---|
| 0 | `select` | the selection (unchanged) |
| 1 | `gates` (new) | skills parse, skill frontmatter, every `scripts/check-*.sh` step, the domain gates, the domain, board and fleet typechecks |
| 2 | `checks` | the gate tests, the domain, board and fleet unit tests, e2e — what `checks` holds minus the steps moved to `gates` |
| 2 | `corpus`, `helper-contracts`, `board-integration`, `macos-shell-contract` | unchanged contents |
| 3 | `census-head`, `census-base`, `census-compare` | the process census, split (second slice) |

The `gates` job moves steps out of `checks` and adds none. A tier-2 job says `needs: [select, gates]`; the census jobs say `needs: [select, gates, checks]`.

**The census waits on `checks`, not on the suites.** Waiting on `helper-contracts` and `board-integration` (~12 min on all four heads above) and then running a split census of ~20 min gives ~32 min on green, which removes the split's gain. Waiting on `checks` (~6 to 8 min) gives ~27 min on green. On d1117a0a8 the failed `checks` would have skipped the census entirely, and the run would have ended at ~13 min, not ~26 min.

**The mechanism is `needs:` plus a result condition, not a run cancel.** A job keeps its selection condition and replaces `!cancelled()` with a check of every job it needs, for example `if: ${{ !cancelled() && needs.gates.result == 'success' && needs.select.outputs.board != 'false' }}`. A failed `gates` then skips every job still waiting on it. Two alternatives fall out:

- A step that calls `POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancel` on failure needs `actions: write`, where the workflow grants `contents: read` (`ci.yml:54-55`). It also turns the running siblings `cancelled`, and `runWasTimedOut` reads a job cancelled after 5 minutes as a `timeout-minutes` cap (`packages/domain/src/rules/checks-verdict.ts:182`, `:215`). The fleet would then report a timeout for a test failure.
- A `concurrency` change cancels runs, not jobs within one run.

So a sibling already running in the same tier runs to its end. Only jobs still waiting are skipped.

**`validate` keeps its semantics.** It stays the one required check, `needs:` every gating job and `if: ${{ !cancelled() }}` (`ci.yml:2306-2310`). Its last step (`ci.yml:2338`) adds `require gates "$GATES" true`. A tier-2 job that `gates` skipped reads `skipped` while `select` named it `true`, which the existing `require` already fails (`ci.yml:2296-2305`, the comment that states the rule). The census jobs stay outside `validate`'s `needs:`, as `process-census` is today (`ci.yml:547-549`).

**Green cost.** On a green run, every tier-2 job now starts after `gates` ends. The slice measures `gates` on its own PR and states the wall time beside `validate`'s. If `gates` ends after more than 4 minutes, the slice moves the longest step back to `checks` and says which.

**Every long job states `timeout-minutes` and why.** Every job already has a job-level cap (`select` 10, `corpus` 15, `macos-shell-contract` 15, `process-census` 50, `helper-contracts` 18, `board-integration` 22, `checks` 25, `validate` 5). The new jobs get one each, and each cap carries a comment that names its measurement, as `board-integration`'s does (`ci.yml:842-860`). The census jobs get the HEAD half's measured 830 s plus setup (`ci.yml:634-639`, `:554-558`).

**The census halves run in parallel.** `census-gate.mjs` gains three modes:

- `--only head --report <file>`: runs the census against HEAD and writes the report. This is `census-head`'s step.
- `--only before (--base <ref> | --before <sha>) --report <file>`: adds the merge-base worktree, builds it and runs HEAD's census rows against it (`census-gate.mjs:69-76`). This is `census-base`'s step.
- `--compare <head report> <before report>`: runs `compareCensus` (`census-gate.mjs:77`) and exits as today. This is `census-compare`'s step.

Each half uploads its report with `actions/upload-artifact`, pinned by SHA as the workflow pins its other actions, and `census-compare` downloads both. No workflow uses an artifact today, so the slice adds the first. `census-compare` `needs: [census-head, census-base]` and runs when `census-head` succeeded. A failed `census-base` reads every row as "no before", as a failed build does today (`census-gate.mjs:71-72`).

**HEAD first, where the halves share a process.** Without `--only` and `--compare`, `census-gate.mjs` keeps its one-process mode for a local run, and it now returns before the worktree when HEAD's census failed (between `census-gate.mjs:64` and `:69`). In CI the two halves run in parallel, so a red HEAD no longer saves the merge-base half's runner minutes — it saves wall time instead. The Open Questions name this trade.

**The contract gate.** A new contract test, `test/reconcile/ci-tiers.test.mjs`, reads `ci.yml` with the `jobBlock` pattern of `test/reconcile/ci-selection-jobs.test.mjs:23-26` and refuses:

- a job in tier 2 or 3 whose `needs:` lacks `gates`, or whose `if:` does not test `needs.gates.result == 'success'`;
- a census job whose `needs:` lacks `checks`;
- a step that runs `census-gate.mjs` with `--only before` in a job that also runs `--only head`, or a one-process census step (a two-tree job that runs both halves in one job);
- a job with no job-level `timeout-minutes`, or a cap with no comment line in the five lines above it.

`ci-selection-jobs.test.mjs:211-215` asserts `checks` says `needs: select` and `if: ${{ !cancelled() }}`; the first slice changes that test to the new edge, and `:219-222` to `validate`'s new `needs:`.

**Local checks, cheapest first.** Declaration order stays the contract: the rule keeps it (`local-checks.ts:345`) and stays project-agnostic, and the project states its cost order by the order it declares. This repository reorders its own key in `CLAUDE.md:56`: the `scripts/check-*.sh` chain first, then the three typechecks, then the gate tests, then `vitest related` and `node --test {tests}`. `AGENTS.md` follows through `./scripts/check-agents-md.sh --write`. `skills/plot-init/` tells an adopting project to declare its checks cheapest first. `local-checks.test.mjs` gains a row that holds this repository's key in that order, and a rule row in `packages/domain/test/` holds that `localChecks` keeps declaration order when the changed paths arrive in another order.

**`--run`.** `plot-local-checks.mjs --run` runs each printed command in order through `bash -c` and stops at the first failure, with the command and the last 80 lines of its output (`CHECKS_TAIL_LINES`, `packages/domain/src/rules/local-checks-run.ts:8`). It reuses `printedCommands` and `failedCheck` from that file, which the fleet's runner already uses (`worker-loop.ts:50`). It exits 0 on a pass, 1 on a failed command, and 2 on a usage error, as today (`packages/board/src/server/entry/local-checks.ts:352`).

**`--base <branch>`, and the default without a host call.** The base resolves in this order:

1. `--base <branch>`, passed as `against` to `changedFiles` (the port takes it, `packages/domain/src/ports/refs.ts:280-290`).
2. The sprint convention: the plan that names HEAD's branch, found by the lookup `plot-open-pr.sh` uses (`skills/plot/scripts/plot-open-pr.sh:93-97`), carries `Sprint: <slug>`, and `origin/sprint/<slug>` exists locally. The base is then `sprint/<slug>`.
3. The default branch, as today (`refs-git.ts:448`).

Upstream tracking does not answer the question: a slice branch tracks its own remote branch, not its PR's base. A host call (`gh pr view --json baseRefName`) is not in the chain: a wrong guess falls back to the default branch, which selects more checks and never fewer, and a local check spends no host budget. The fleet's runner passes the same default, so a dispatched sprint slice checks only its own changes.

**Skip a job whose inputs did not change (riskiest, deferred).** `select` gains one more read. For each job it asks for the newest run on the same head branch whose job of the same name ended `success`, through `plot-host.sh`, then runs `plot-local-checks.mjs --ci --files` over `git diff --name-only <that SHA> HEAD`. A job whose selection output is `false` for that diff outputs `reused:<sha>`, and `validate`'s `require` accepts `skipped` with `reused:<sha>` as it accepts `false`. A green result counts only for a SHA whose diff to HEAD lies outside the job's inputs, where "inputs" means the paths the existing map (`ci.yml:180-226`) would select the job for. A push to `main` and a dispatched run never reuse. On 8437242ef (docs only since a269f54d6) this skips the census and the suites, and the run ends after `gates` and `checks`.

### Open Questions

- [ ] **Reuse trusts a past run.** A pull request run tests the merge of its head with `main` (`ci.yml:173` diffs `HEAD^1 HEAD` on that merge), so the tree a green run tested holds the `main` of its own time. Reusing it after `main` moved skips a job whose real input changed. A flaky test that passed once also stays green until an input changes. Options: reuse only while `main`'s SHA in the merge is unchanged; reuse only for a non-required job (the census); or do not ship the slice. A person decides at approval whether the fourth slice ships; it carries `deferred:` until then.
- [ ] The parallel census spends the merge-base half's ~15 runner minutes on a red HEAD, which the one-process mode saves. Is the wall-time gain (~33 to ~20 min on green) worth that runner time?
- [ ] `gates` adds its own wall time to every green `validate`. Is a 4-minute ceiling the right bound, or should the suites start beside `gates` and accept the longer red path?
- [ ] Should `corpus` and `macos-shell-contract`, which are not required, wait on `gates` too? The proposal says yes: their result means nothing while a static gate is red.
- [ ] The sprint convention reads `origin/sprint/<slug>` from the plan's `Sprint:` field. A sprint whose branch name differs from its slug falls back to the default branch. Should the sprint file declare its branch instead?

## Done when

| Claim | Check | Slice |
|---|---|---|
| A failed static gate skips every tier-2 and census job still waiting | a test PR that breaks `check-plan-headings.sh` shows `gates` failed, the tier-2 and census jobs skipped, and `validate` failed | CI tiers |
| `validate` fails on a skipped job the selection named | `ci-selection-jobs.test.mjs` runs `validate`'s step with `GATES=failure` and with a tier-2 job `skipped` while selected | CI tiers |
| A job without `needs: gates` or without a commented cap is refused | `ci-tiers.test.mjs` over a copy of `ci.yml` with each defect | CI tiers |
| `gates` stays under 4 minutes on green | the slice's PR states `gates`' wall time and `validate`'s | CI tiers |
| The census halves run in parallel and compare | the slice's PR shows `census-head` and `census-base` overlap, and `census-compare` prints the rows | Census halves |
| A green census ends in about 20 minutes | the census wall time on the slice's PR, against ~33 min on a269f54d6 | Census halves |
| The one-process census skips the merge base when HEAD fails | a `census-gate.mjs` row with a failing `--run` adds no worktree | Census halves |
| A two-tree job that runs the merge base first is refused | `ci-tiers.test.mjs` over a copy of `ci.yml` with one census step running both halves | Census halves |
| Local checks print the static gates first | `local-checks.test.mjs` holds this repository's key order; a domain row holds declaration order | Local checks |
| `--run` stops at the first failure | a `local-checks.test.mjs` row with a failing first command shows the second never ran | Local checks |
| A sprint slice checks only its own changes | a `local-checks.test.mjs` row on a slice branch off `sprint/<slug>` prints only the slice's tests; `--base main` prints the sprint's | Local checks |
| A docs-only push reuses the last green run | a test PR's docs-only push shows the census and the suites `skipped` with `reused:<sha>` and `validate` green | Unchanged inputs |

## Slices

### CI tiers

- `infra/ci-cheap-tier-first` — the `gates` job (static steps moved out of `checks`), `needs: [select, gates]` and the result condition on every tier-2 job, `needs: [select, gates, checks]` on `process-census`, `validate`'s `require gates`, a measured comment on every job cap, `test/reconcile/ci-tiers.test.mjs`, and the edge changes in `ci-selection-jobs.test.mjs`. Expected saving: a red static gate ends the run at the `gates` time instead of ~26 min (d1117a0a8); a red `checks` skips the census and ends the run at ~13 min <!-- builds: the CI tier contract test, ci-tiers.test.mjs -->

### Census halves

- `infra/census-parallel-halves` — `census-gate.mjs` `--only head|before`, `--compare` and HEAD-first in the one-process mode; the `census-head`, `census-base` and `census-compare` jobs with the report artifacts; the two-tree rows in `ci-tiers.test.mjs`. Expected saving: a green census from ~33 min (a269f54d6) to ~20 min of wall time <!-- builds: census-gate.mjs split modes and the parallel census jobs -->

### Local checks

- `infra/local-checks-cheapest-first` — this repository's `Local checks` key reordered cheapest first with the `AGENTS.md` mirror, the `plot-init` guidance, `plot-local-checks.mjs --run` and `--base` with the sprint-branch default, the fleet runner on the same default, and the rows in `local-checks.test.mjs` and the domain tests. Expected saving: a sprint slice runs its own tests instead of the sprint's 40 to 60 test files; the slice measures one slice of `the-board-reads-the-channel` before and after <!-- builds: plot-local-checks.mjs --run and --base -->

### Unchanged inputs

- `infra/ci-skips-unchanged-inputs` — the reuse read in `select`, the `reused:<sha>` output, `validate`'s acceptance of it, and the contract rows. Expected saving: a docs-only push such as 8437242ef ends after `gates` and `checks` instead of ~45 min <!-- builds: CI job reuse across a branch's green runs --> <!-- deferred: a person decides at approval whether this slice ships; see Open Questions -->

## Notes

- Measurements from sprint PR #3237 on 2026-11-08. Line numbers checked against the worktree of `idea/batch-the-snapshot-entity` (merge base with `origin/main`: e93c6b8fd) on 2026-11-08.
- Slice PRs into a sprint branch start no CI run: `ci.yml:4-5` limits `pull_request` to base `main`. Only the sprint PR into `main` runs these jobs, so the measured heads are all sprint-PR heads.
- Definition of Done: docs/definition-of-done.md.
