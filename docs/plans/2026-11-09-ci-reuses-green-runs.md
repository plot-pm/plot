# CI reuses green runs

> On a pull request, `select` skips a job that an earlier run of the same pull request passed, while the base SHA of that run's merge equals the base SHA of this run's merge and the head change between the two runs selects no input of the job. The skipped job reports `reused:<sha>`, `validate` accepts it, and any move of the base re-runs every job.

## Status

- **State:** Draft
- **Type:** infra
- **Review:** pr
- **Impl:** own branches

## Changelog

- A push to a pull request skips `helper-contracts`, `board-integration`, `corpus`, `macos-shell-contract` and the process census when an earlier run of the same pull request passed them on the same base and the push changes none of their inputs. The step summary names the run and the head SHA each skipped job reuses.
- A push to `main`, a dispatched run, and every run after the base branch moved run every selected job, as today.

Board impact: none on the plan format, the template, the helper scripts or the `docs/plans` layout. A reused job reads `skipped` in the check rollup, and `validate` stays the one required check, so `checks-verdict.ts` reads the same run shape.

## Motivation

`quality-gates-fail-fast` (delivered 2026-11-09) shipped the tiers, the census halves and the local check order, and deferred its fourth slice, `infra/ci-skips-unchanged-inputs`. Its first Open Question named the risk: "A pull request run tests the merge of its head with `main` … Reusing it after `main` moved skips a job whose real input changed." A person decided at approval whether the slice ships; this plan takes it over with the rule decided on 2026-11-09.

The cost the slice targets is still there. On sprint PR #3237, head `8437242ef` changed only documents since `a269f54d6`, and its run took about 45 minutes, against about 33 minutes for the green run before it (`quality-gates-fail-fast`, *Motivation*). `select` diffs `HEAD^1 HEAD` on the pull request's merge commit (`ci.yml:175`), so it reads the whole pull request against its base, not the change since the last green run. A sprint PR selects every suite on every push, because the sprint's diff touches every package.

## Design

This plan has no `Story:`. It touches `select`, the `if:` of the reusable jobs and `validate` in `.github/workflows/ci.yml`. The open plan `ci-cancels-superseded-runs` (PR #3305, branch `origin/idea/ci-cancels-superseded-runs`) touches the `concurrency:` block (`ci.yml:57-68`), and `sprint-prs-run-ci` in this batch touches the `on:` block (`ci.yml:3-7`) and the merge-base gates. No two of the three change the same lines.

### Approach

**The reuse rule, decided 2026-11-09 (jwloka).** A green job of an earlier run is reused only while the base SHA in that run's merge equals the base SHA in this run's merge. Any move of the base re-runs every job. A pull request run checks out `refs/pull/<n>/merge` (`ci.yml:140-144`, `fetch-depth: 2`), so `HEAD^1` is the base branch's tip that the run tested and `HEAD^2` is the pull request's head. Two runs with the same `HEAD^1` tested the same base, and their trees differ only by the head change `HEAD^2(earlier)..HEAD^2(now)`. The rule therefore leaves one input to compare: the head diff.

**Slice 1: every run records what it tested.** The Actions API gives a `pull_request` run's `head_sha` (the pull request head) and no merge SHA, so a later run cannot learn the earlier run's base from the API. `select` records it:

- A new step after checkout, on `pull_request` only, uploads an artifact named `ci-inputs-<HEAD^1>-<HEAD^2>` with `actions/upload-artifact`, pinned by the SHA the census halves use (`ci.yml:687`), and `retention-days: 7` as for the census reports (`ci.yml:693`). The file inside holds the two SHAs and the selection, for a person who reads it.
- The name carries the two SHAs, so a later run reads them from `GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts` without a download.
- The step is `continue-on-error: true`. A run that uploads no record is never a source, and nothing else changes. This slice changes no job's result, and it ships first so that the second slice finds records.

**Slice 2: `select` reads the earlier runs and skips what it may reuse.**

- **The read.** A step `Read the earlier green runs`, on `pull_request` only and `continue-on-error: true`, asks `gh api` with `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`: the 20 newest completed `pull_request` runs of `ci.yml` on `github.head_ref`, then for each run the jobs and the artifact names. `select` gains a job-level `permissions:` block with `contents: read` and `actions: read`, the pair `relay-validate` holds in `release.yml:242-244` for the same kind of read. The workflow-level `contents: read` (`ci.yml:54-55`) stays for every other job.
- **The diff per source.** For each distinct earlier head, the step fetches that commit (`git fetch --depth=1 origin <sha>`) and writes `git diff --name-only --no-renames <earlier head> HEAD^2`. It runs `plot-local-checks.mjs --ci --files` over that list and maps the answer to jobs with the same jq program as `Map the selection to jobs` (`ci.yml:182-228`). That program moves to `scripts/ci-job-map.jq` and both steps read it, so one map answers both diffs. A commit that cannot be fetched (the head was force-pushed away and collected) gives no diff, and that run is not a source.
- **The decision is a domain rule.** `packages/domain/src/rules/ci-reuse.ts` exports `ciReuse(readings)`, an arrow function over values, as `ciSelection` is (`packages/domain/src/rules/local-checks.ts`). The readings are this run's base and head SHAs and, per earlier run, its id, its pull request numbers, its `head_sha`, its conclusion, its recorded base and head, its job conclusions and the job map of its head diff. For each reusable job it answers `reused:<earlier head sha>` or nothing. An earlier run is a source for a job only when:
  - its recorded base equals this run's `HEAD^1`;
  - its recorded head equals its own `head_sha`, and its `pull_requests` names this pull request's number (a fork or a second pull request on a branch of the same name is never a source);
  - its conclusion is not `cancelled`;
  - the job ended `success` in it (a job that the earlier run itself reused ended `skipped` and is not a source, so reuse never chains past the run that ran the job);
  - the job map of its head diff names the job `false`.

  The newest run that holds for a job wins. The census is one unit: `census-head`, `census-base` and `census-compare` are reused together when `census-compare` ended `success`.
- **The bundle.** `skills/plot/scripts/board/plot-ci-reuse.mjs` reads the readings file, calls `ciReuse` and prints one `reuse_<key>=<value>` line per job for `$GITHUB_OUTPUT`. It reaches no host: the `gh api` step makes every call, so the rule stays synchronous and testable without a mock (*A note on shape*, `CLAUDE.md`).
- **The outputs.** `select` gains `reuse_corpus`, `reuse_macos`, `reuse_contracts`, `reuse_board` and `reuse_census`. Each is empty or `reused:<40 hex>`. The selection outputs (`ci.yml:107-117`) do not change, and the selection still fails open: a failed read, a failed fetch or a failed bundle leaves every `reuse_*` output empty, and every selected job runs.
- **The jobs.** `corpus` (`ci.yml:269`), `macos-shell-contract` (`:425`), `census-head` (`:563`), `census-base` (`:698`), `census-compare` (`:846`), `helper-contracts` (`:910`) and `board-integration` (`:1074`) each add `&& needs.select.outputs.reuse_<key> == ''` to their `if:`. `gates`, `checks` and `validate` never reuse: `gates` holds the static gates for every change, and `checks` holds the unit suites and e2e behind step conditions (`ci.yml:2296`, `:2535`, `:2564`, `:2575`, `:2585`).
- **`validate`.** `require` (`ci.yml:2659-2668`) takes a fourth argument, the job's `reuse_*` output. `skipped` passes when the selection named the job `false`, as today, or when the reuse output matches `^reused:[0-9a-f]{40}$`. Any other `skipped` fails, and a malformed reuse value fails. The step's env gains `HELPER_CONTRACTS_REUSED` and `BOARD_INTEGRATION_REUSED`. The step summary names each reused job, its source run and its head SHA.
- **Never on `main` or a dispatch.** The read step runs only on `pull_request`, and the bundle prints empty outputs for any other event. A push to `main` keeps the full run as the safety net for a selection miss (`ci.yml:78-82`), and the release dispatch keeps its pinned full run (`ci.yml:39-43`).

**With `ci-cancels-superseded-runs`.** That plan gives a pull request's runs one concurrency group, so a new push cancels the run on the older head. A cancelled run is never a source, even for a job that ended `success` before the cancel: the rule reads the run's conclusion first. On a pull request with quick successive pushes, reuse therefore starts from the last run that ran to its end. The two plans merge in either order.

**With `sprint-prs-run-ci`.** On a slice PR into a sprint branch, `HEAD^1` is the sprint branch's tip, so "the base is unchanged" means "the sprint branch's SHA is unchanged", not `main`'s. Every slice merged into the sprint branch moves that base for every other open slice PR, and their next runs reuse nothing. The rule compares SHAs and reads no branch name, so it needs no change for a sprint base. A sprint PR into `main` reuses while `main` does not move.

**What reuse cannot see.** A flaky test that passed once stays reused until the base moves or the head changes one of its job's inputs. The 7-day retention of the record bounds how old a source can be. A job's real input outside the `Local checks` map (a runner image update, a third-party action) is not in the diff either; the full run on `main` after the merge is the net for both.

### Open Questions

- [ ] **Where the base SHA is recorded.** This plan names an artifact `ci-inputs-<base>-<head>` and reads its name, which needs `actions: read` on `select`. A step name or a check-run title could carry the same two SHAs and needs the same permission to read. Recommendation: the artifact. The workflow already uploads two (`ci.yml:687`, `:832`), `ci-tiers.test.mjs` already holds their SHA pins, and the name is readable without a download. A person decides.
- [ ] **`gh api` in the workflow or a `plot-host.sh` op.** The read is CI infrastructure of this repository, not a Plot helper, and `check-host-cli-callers.sh` scans `*.sh` under `skills scripts hooks` (`scripts/check-host-cli-callers.sh:82`), not workflows. `release.yml:248-265` already reads the Actions API with `gh api`. Recommendation: `gh api` in the step, with the three-attempt retry of `release.yml:259-272`. A person decides.
- [ ] **A failed run as a source.** The rule takes a job that ended `success` from a run that ended `failure` (for example a red census beside green suites), and refuses only a `cancelled` run. Recommendation: keep it; each job's result stands on its own, and `validate` already reads them one by one. A person decides.

## Done when

| Claim | Check | Slice |
|---|---|---|
| Every pull request run records the base and head it tested | a test PR's run lists an artifact `ci-inputs-<HEAD^1>-<HEAD^2>`; `ci-tiers.test.mjs` refuses a copy of `ci.yml` whose record step is unpinned or runs on `push` | Record inputs |
| A missing record changes no result | `ci-selection-jobs.test.mjs`: the record step carries `continue-on-error: true` and no job reads its outcome | Record inputs |
| A moved base reuses nothing | `ci-reuse.test.ts`: an earlier green run whose recorded base differs from this run's `HEAD^1` is no source for any job | Reuse |
| A cancelled run is never a source | `ci-reuse.test.ts`: a run with conclusion `cancelled` and a job that ended `success` is no source | Reuse |
| Reuse never chains | `ci-reuse.test.ts`: a job that ended `skipped` in the newest run takes the older run that ran it, or none | Reuse |
| A head change that selects a job re-runs it | `ci-reuse.test.ts`: a head diff whose job map names `board` `true` leaves `reuse_board` empty | Reuse |
| Another pull request on the same branch name is no source | `ci-reuse.test.ts`: a run whose `pull_requests` lacks this number, or whose `head_sha` differs from its record, is no source | Reuse |
| `validate` accepts a reused job and nothing looser | `ci-selection-jobs.test.mjs` runs `validate`'s step: `skipped` with `reused:<40 hex>` passes; `skipped` with `reused:` or `reused:abc` fails; `failure` with a reuse value fails | Reuse |
| Each reusable job skips on a reuse value | `ci-selection-jobs.test.mjs`: the `if:` of the seven jobs tests `needs.select.outputs.reuse_<key> == ''`; `gates`, `checks` and `validate` test no reuse output | Reuse |
| `main` and the dispatch never reuse | `ci-selection-jobs.test.mjs`: the read step runs only on `pull_request`; the bundle prints empty outputs for `push` and `workflow_dispatch` | Reuse |
| The selection still fails open | `ci-selection-jobs.test.mjs`: a failed read step, a failed fetch and a failed bundle each leave every `reuse_*` output empty | Reuse |
| One job map answers both diffs | `ci-selection-jobs.test.mjs` runs `scripts/ci-job-map.jq` for the selection rows it runs today, unchanged | Reuse |
| A docs-only push reuses the last green run | a test PR's documents-only push shows `helper-contracts`, `board-integration` and the census `skipped` with `reused:<sha>` in the summary, and `validate` green | Reuse |

## Slices

### Record inputs

- `infra/ci-reuses-green-runs-record` — the `select` step that uploads `ci-inputs-<HEAD^1>-<HEAD^2>` on `pull_request`, pinned by SHA with `retention-days: 7` and `continue-on-error: true`, and the rows in `ci-tiers.test.mjs` and `ci-selection-jobs.test.mjs` <!-- builds: a per-run CI record of the base and head SHAs a pull request run tested -->

### Reuse

- `infra/ci-reuses-green-runs` — `scripts/ci-job-map.jq`, the `gh api` read step and `actions: read` on `select`, `ciReuse` in `packages/domain/src/rules/ci-reuse.ts` with `ci-reuse.test.ts`, the bundle `plot-ci-reuse.mjs`, the `reuse_*` outputs, the seven job conditions, `validate`'s fourth `require` argument, and the contract rows; merges after `infra/ci-reuses-green-runs-record` <!-- builds: ciReuse, CI job reuse while the merge's base SHA is unchanged -->

## Notes

- Decided 2026-11-09 by jwloka (Jan Wloka): a green job is reused only while the base SHA in the earlier run's merge equals the current base SHA; any move of the base re-runs everything. This answers the first Open Question of `quality-gates-fail-fast` and replaces its options "reuse only for a non-required job" and "do not ship the slice".
- Takes over the deferred slice `infra/ci-skips-unchanged-inputs` of the delivered plan `docs/plans/2026-11-09-quality-gates-fail-fast.md`, whose branch line now points here. This plan uses its own branch names, so no two plans name one branch.
- Line numbers checked in the worktree of `idea/batch-refs-from-files` (cut from `origin/sprint/the-board-reads-the-channel` at `11a270538`) on 2026-11-09. `ci.yml` holds 2,675 lines.
- Deliverable search (`plot-deliverable-search.sh`) for "ci reuses green runs", "reused", "skip unchanged inputs" and "base SHA unchanged" found no existing deliverable. The hits name unrelated reuse (`listing-spend.ts`, `auto-dispatch.ts`) and the merge-base gates `sprint-prs-run-ci` changes.
- Definition of Done: docs/definition-of-done.md.
