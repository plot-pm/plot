# Panel moderation: ci-reuses-green-runs

Subject: `docs/plans/2026-11-09-ci-reuses-green-runs.md` (Draft). Round 1. Moderated 2026-11-09.

## Reconcile

`plot-panel.mjs reconcile` answered:

```
unanimous	amend	correctness,cost,operator
```

All three jurors hold `amend`. The positions agree. The amendments are not all the same, and one of them conflicts with another (see *Disagreements*).

## What Each Juror Looked At

- **Correctness** read `ci.yml` (2,675 lines), `release.yml`, `scripts/check-host-cli-callers.sh` and the cancels plan on `origin/idea/ci-cancels-superseded-runs` (`ccdfe9b82`). It ran Actions API reads: run 42613010489 keeps `pull_requests: [3310]` after a new push, a fork run lists `[]`, and run 42605350975 ended `validate` at 11:15:59 and completed at 11:24:52. It counted 7 of the 10 newest `pull_request` runs on `sprint/the-board-reads-the-channel` as `cancelled`. It built the merge counterexample by reasoning. It did not run it as a git experiment.
- **Cost** measured the most. It read the 500 newest `pull_request` runs over the Actions API (2026-11-05 to 2026-11-09, 4.1 days), job timings for 60 green runs, and `compare` diffs mapped through `plot-local-checks.mjs --ci` and the `ci.yml:182-228` jq program. Its base-move reading is a proxy (a first-parent commit on `origin/main` between two `created_at`), not the recorded `HEAD^1`.
- **Operator** read `ci.yml`, `release.yml`, `checks-verdict.ts:215-229` and the cancels plan. Its claims about the checks page (grey `skipped` with no text, re-run behaviour, `expired: true` on the artifact list) come from GitHub's documented behaviour. It did not observe a run.

## Shared Amendments, Applied To The Plan

No juror contests any of these. Each was checked against `ci.yml` before it was written.

1. The reuse diff is `diff(H1, H2) ∪ (P1 △ P2)`, with each run's `changed.txt` (`ci.yml:175`) stored in the record. The plan said the head diff was the only input left. That is false for a branch that rebases or merges its base while the base stays the same. The residual case (a three-way textual merge under two merge bases) is named in *What reuse cannot see*. (correctness 1)
2. A job is reused only when its recorded selection matches this run's: the flag, `contracts_tests` and `corpus_tests`. Markdown outside `skills/` is dropped from `$wide` at `ci.yml:203`, so an edit to `CLAUDE.md`'s `Local checks` key alone selects no job and can still widen `contracts_tests` (`ci.yml:213`). (correctness 2)
3. A test row: a reused `skipped` passes only while `gates` ended `success`. (correctness 4)
4. The read has a call order. It filters on the run list's own fields, stops at the first base mismatch, and reads jobs and downloads the record only for a base-matching run. The peak load is in the plan: 16 runs per hour × 41 calls = 656 of 1,000. (cost)
5. The Motivation gains the measured saving: about 850 runner-minutes in 4.1 days without the cancels plan and about 200 with it, 2 to 3 shorter sprint runs per day, and minutes that are not billed. (cost)
6. The `release.yml:242-244` citation is corrected. It holds `actions: read` and `statuses: write`. "A sprint PR selects every suite on every push" is softened. (cost)
7. Expired records (`expired: true`) are dropped. Without this, the 7-day bound did not hold. (operator)
8. `select` names the source run. Its summary has a table with a run link, head SHA, base SHA and conclusion, and it emits one `reused` notice per job. `validate` cannot name the run id from a `reused:<sha>` value. (operator 1, 2)
9. Run attempt 2 or later reuses nothing, so `Re-run all jobs` is a full run. (operator 3)
10. Every reusable job that runs gets a reason, and a failed read writes a `::warning::`. (operator 4)
11. The bundle prints only well-formed values, so a malformed value runs the job. (operator 5, extended by the moderator: see the blind spot)
12. The release PR (`changeset-release/*`) never reuses, the same way the cancels plan isolates it. (operator)
13. The cancels plan's slice branch `infra/ci-cancels-superseded-runs` and group key `pr-<number>` are named. (operator, correctness; the moderator confirmed both on `origin/idea/ci-cancels-superseded-runs`)

All three jurors share the recommendations on Open Questions 1 to 3: the artifact, `gh api` in the step, and keeping a `failure` run as a source. The plan records them as unanimous and leaves the decision to the person.

## Disagreements

- **A cancelled run as a source.** Correctness wants each job judged on its own result, including jobs from cancelled runs. A job's `success` is final, and under the cancels plan most sprint runs end `cancelled`, some after `validate` passed. Cost measured that this recovers 16 runner-minutes over 6 runs in 4.1 days, and it keeps the refusal. The two do not conflict on the facts. Correctness argues from consistency with Open Question 3, and cost argues from the measured return. Cost measured only adjacent pairs, and correctness's nine-minute census tail is the case those pairs undercount. The plan now carries this as Open Question 4.
- **What the record holds.** Cost and operator built the budget on reading artifact names with no download. Correctness's amendment 1 needs the contents. This is not a disagreement about the answer. The applied read downloads only for base-matching runs, so cost's early stop keeps the download count at 0 to 1 per run.

## Shared Blind Spot

All three lenses wrote as if `validate` guards every reusable job. It does not. `validate`'s `needs:` is `[select, gates, checks, helper-contracts, board-integration]` (`ci.yml:2613`), so 2 of the 7 reusable jobs pass through `require`. `corpus`, `macos-shell-contract` and the three census jobs are outside the required check today. A malformed or wrong `reused:` value on them skips the job and no check fails. Operator 5 says a malformed value "fails `validate`", which holds for 2 jobs and not for 5. The plan now makes the bundle the guard: it prints only `^reused:[0-9a-f]{40}$` or empty. Its claim "`validate` accepts it" now covers only the two jobs `validate` reads.

## Leftovers for the person

1. **A cancelled run as a source (Open Question 4).** Should a job that ended `success` in a run that ended `cancelled` be reused? Options: (a) keep the refusal (cost: it recovers 16 runner-minutes over 6 runs in 4.1 days); (b) judge each job on its own result, as for `failure` (correctness: under `ci-cancels-superseded-runs`, 7 of 10 recent sprint runs end `cancelled`, some after `validate` passed). The operator did not take a position.
2. **Confirm Open Questions 1 to 3.** All three jurors recommend the same answer: (1) record in an artifact, whose contents are now read; (2) `gh api` in the step with the `release.yml` retry; (3) a `failure` run stays a source for its green jobs. Accept, or name a different answer.
