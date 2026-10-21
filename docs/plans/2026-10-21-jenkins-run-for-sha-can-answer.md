# Jenkins run-for-sha can answer a NOT_BUILT build

> Under `CI: jenkins`, `plot-host.sh run-for-sha` and `runs-for-sha` can return a `NOT_BUILT` build as the run for a sha, so a head whose only build is `NOT_BUILT` reads as completed/`NOT_BUILT` instead of "no run".

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** bitbucket-jira-and-jenkins-work-with-the-board
- **Issue:** #2214
- **Review:** pr
- **Impl:** own branches

## Changelog

- Jenkins: `run-for-sha` and `runs-for-sha` skip `NOT_BUILT` builds, as `runs` does. A head whose only build is `NOT_BUILT` reads as no run, and a newer `NOT_BUILT` build no longer hides an older result of the same sha. `ABORTED` stays in the sha arms.

## Motivation

`jenkins_sha_runs` drops `NOT_BUILT` only when no sha is asked (`skills/plot/scripts/plot-host.sh:1808`). #2181 kept it in the sha arms on purpose (`test/reconcile/host.test.mjs:3647` and `.changeset/jenkins-runs-skip-builds-that-did.md`), on the ground that a caller that pins a sha wants to see a not-built state. No consumer reads one: `jenkinsConclusion` maps `NOT_BUILT` to `unknown` because nothing ran (`packages/domain/src/adapters/build/build-jenkins.ts:15`, `:31-32`), and a newer `NOT_BUILT` build hides an older real result in `newestPerSha` (`build-jenkins.ts:50-58`) and in `run-for-sha`'s `.[0]` (`plot-host.sh:4719`). That reason still holds for `ABORTED`, because a cancellation of that exact sha did happen, so `ABORTED` stays.

Effect per consumer, measured from the code on main 2026-10-21:

- **The agent's CI wait** (`worker-loop.ts:988`): unchanged when a head's only build is `NOT_BUILT`, because `unknown` never settled the wait (`checks-verdict.ts:137`, `:287-298`). When a newer `NOT_BUILT` build hid an older FAILURE or SUCCESS of the same sha, the wait now settles and the agent gets its correction, where today it ends `no-answer`.
- **The default-branch reading** (`default-branch-refresh.ts:113`, `:195`): a commit whose newest build is `NOT_BUILT` now reads green or red from its real build, not `unknown`.
- **The board's PR binding** (`jenkins-pr-checks.ts:112-120`): the row shows the same word (`unknown`), now unbound, so the rotation (`:88`) sorts it first and it spends one of the 5 lookups per pass.

### Not fixed here

A second defect sits in the same function: the sha match (`plot-host.sh:1809`, `any(.shas[]; …)`) accepts a merge-before-build job's merge-base revision, so a build can answer for a sha it built only as the base. It affects SUCCESS and FAILURE builds too, and the fix above does not touch it. Which of the two caused the field-test symptom (`runs-for-sha add-bdd 501496d013ad`) is not measured. It is filed as #2229.

## Design

### Approach

1. **The sha arms drop `NOT_BUILT`.** `jenkins_sha_runs` removes `NOT_BUILT` builds before the sha match on both sha arms. `ABORTED` keeps its current per-arm rule. The fix stays inside the jq program of `jenkins_sha_runs`, the one place that reads `result`.
2. **Tests.** Rename the test at `host.test.mjs:3647` to say that the sha arms still return an `ABORTED` build, and rewrite its comment. Add three fixtures, each build with one revision: a sha whose only build is `NOT_BUILT` (both arms answer none or empty); a `NOT_BUILT` build newer than a `FAILURE` of the same sha (`run-for-sha` answers `FAILURE`); and an `ABORTED` build (still returned).

### Open Questions

- [x] Does `ABORTED` drop out of the sha arms too? No: a cancellation of that sha did happen, which is the reason #2181 gave, and it still holds for `ABORTED`. Decided in the challenge of 2026-10-21.
- [x] Does any consumer rely on the `NOT_BUILT` row? No: every consumer reads it as `unknown`. The effects are listed under Motivation.

## Slices

- `bug/jenkins-run-for-sha-can-answer` — skip `NOT_BUILT` in the sha arms of `jenkins_sha_runs`, with the three single-revision fixtures and the renamed `ABORTED` test

## Notes

Related plan on the same arm: `2026-10-20-a-sha-bound-run-reports-the` (Delivered, #2181).
