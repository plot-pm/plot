# Cost juror: ci-reuses-green-runs

Position: amend

## Measurement

Source: `gh api` over the 500 newest `pull_request` runs of `ci.yml` (2026-11-05 09:10 to 2026-11-09 12:13, 4.1 days), job timings for 60 green runs and for both runs of every eligible pair, and `compare` diffs mapped through `plot-local-checks.mjs --ci` and the jq program of `ci.yml:182-228`. The base move is read as "`origin/main` gained a first-parent commit between the two runs' `created_at`". This is a proxy: the API gives no merge SHA, which is the plan's own premise for slice 1.

- 226 of 500 runs are `changeset-release/main`, and 216 of those ended `action_required`. 274 runs remain.
- `main` moves about 3.8 times per hour (727 first-parent commits since 2026-11-01). 46 of the commits since 2026-11-05 are `plot: build the board artifact` by `plot-build[bot]`, so every merge moves the base twice.
- Of 183 consecutive push pairs on one branch (release PR excluded), 84 kept the base (46 %). Sprint PRs keep it more often: 59 of 95 (62 %). Other PRs: 25 of 88 (28 %). The median gap between pushes is 10 min.
- A green PR run uses a median 29 runner-minutes. Per-run medians: `process-census` 27 min, `census-head` 13, `census-base` 13, `board-integration` 11, `helper-contracts` 8, `checks` 7 (never reusable), `corpus` 3, `macos-shell-contract` 2.
- Docs-only head diffs (`docs/plans`, `docs/sprints`, `sessionlogs`) still select `corpus` (27 of 36 green-source pairs). They select nothing else.

## Saving under the "base unchanged" rule

- Without `ci-cancels-superseded-runs`: 37 later runs would reuse at least one job, about 850 runner-minutes in 4.1 days. Sprint PRs give 750 of them. The census gives most: on `sprint/nothing-runs` it was reused 8 times at 32 to 35 min each.
- Success-only sources (Open Question 3 answered "no") halve that to about 440 runner-minutes.
- With `ci-cancels-superseded-runs`: 51 of 76 eligible pairs had the next push arrive before the earlier run ended. That plan cancels the earlier run, and this plan refuses a cancelled run as a source. The adjacent-pair saving falls to about 200 runner-minutes over 10 runs in 4.1 days (2 to 3 runs per day). Older non-adjacent sources add some, not measured.
- Jobs that ended `success` before the cancel would recover only 16 runner-minutes over 6 runs. Keep the plan's refusal of a cancelled run; changing it buys nothing.
- The repository is public (`gh repo view`: `PUBLIC`). Hosted runner minutes are not billed. The real saving is wall-clock: where the census is reused, the critical path falls from about 35 min to `checks` (about 8 min). Where `board-integration` or `helper-contracts` is reused beside a running census, wall-clock does not change.

## Cost of the read

- As written: 1 runs list call plus, for each of 20 runs, one jobs call and one artifacts call, so up to 41 calls per PR run, plus up to 20 `git fetch --depth=1`.
- Peak load measured: 16 non-release PR runs in one hour (2026-11-09 10:00 UTC). 16 x 41 = 656 calls per hour against the `GITHUB_TOKEN` limit of 1,000 per hour per repository, shared with `release.yml`.
- The runs list response already carries `conclusion`, `head_sha` and `pull_requests`. Filter on those first, read artifacts next, and read jobs only for a run whose recorded base equals `HEAD^1`. Stop at the first run whose recorded base differs, because the base only advances. An early stop can only lose a reuse, never add one. Expected cost: 2 to 4 calls and 0 to 1 fetch per run.
- Upload cost: one tiny artifact per PR run, about 2 s, 7-day retention. Negligible.
- `select` time: one fetch and one bundle call per source, seconds against a 0.5 min job with a 10 min timeout.

## Open Questions

1. Base SHA record: use the artifact. Its listing costs one call per run, the same as a check-run read, and the upload action is already pinned (`ci.yml:687`, `:832`).
2. `gh api` in the step, with the retry of `release.yml:259-272`. `check-host-cli-callers.sh` does not scan workflows. Add the call order above.
3. A failed run as a source: keep it. It doubles the measured saving (440 to 850 runner-minutes) and each job conclusion stands alone.

## Leftovers

- Dependency: branch `origin/idea/ci-cancels-superseded-runs` exists. Its group key is `pr-<github.event.pull_request.number>` for `pull_request` runs, `github.run_id` for `main` pushes and for the release PR's `pull_request` run, and `release-dispatch` for dispatches (plan lines 31-33). The plan here reads runs by `github.head_ref` and filters on `pull_requests` number, which is compatible. Older runs of an open PR keep their PR number in `pull_requests` (236 of 236 checked); only closed PRs read empty.
- The reuse rule of 2026-11-09 holds in the design. The measurement shows its price: it removes 54 % of the pairs before any other condition applies, and the cancel plan removes most of the rest.

## What the plan gets wrong or leaves out

- Motivation states no expected saving. Add the measured figures above, say that minutes are not billed, and name wall-clock on sprint PRs, chiefly the census, as the target.
- The read has no call budget. At peak it uses about two thirds of the token limit. Add the call order and the early stop to slice 2, and add a `ci-reuse` contract row that the step reads jobs only for a base-matching run.
- `release.yml:242-244` holds `actions: read` and `statuses: write`, not `contents: read` and `actions: read`. Correct the citation. The plan's own pair for `select` is right, because a job-level block replaces the workflow-level one.
- "A sprint PR selects every suite on every push" is not always true: several `sprint/the-board-reads-the-channel` runs selected only `corpus`.

## The change that matters most

Add the call order with the early stop to slice 2, and state the expected saving (about 200 runner-minutes and 2 to 3 shorter sprint runs per day once superseded runs are cancelled) in Motivation, so approval weighs the real figure.
