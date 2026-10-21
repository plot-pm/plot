# Jenkins run-for-sha on the default branch reports no answer when the branch builds in another job

> Under `CI: jenkins`, `plot-host.sh run-for-sha` and `runs` exit 4 with "Jenkins did not answer" when the multibranch job has no job for the default branch, so fleetd writes no `default-branch.json` and nothing warns.

## Status

- **State:** Approved
- **Sprint:** bitbucket-jira-and-jenkins-work-with-the-board
- **Type:** bug
- **Issue:** #2278
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2285 merged
- **Started:** 2026-10-21, Jan Wloka, `bug/jenkins-run-for-sha-on-the`

## Changelog

- Jenkins: `run-for-sha` and `runs` for a branch the multibranch job does not hold answer "no run for this sha" (empty) instead of exit 4, and a way to name the job that builds the default branch is available.

## Motivation

Found by the read-only ewz field test, round 6, on main `b33d3ee22`. On ewz-kus-portal (Bitbucket + Jenkins), `plot-host.sh run-for-sha develop <sha>` and `plot-host.sh runs develop` print `plot-host: run-for-sha — Jenkins did not answer for '<host>'` and exit 4, although Jenkins answered.

The project builds `develop` in a separate job (`kus-portal/continuous-deploy`), not in the multibranch job `kus-portal/continuous-build-multi`. In `jenkins_sha_runs` (`skills/plot/scripts/plot-host.sh:1816-1828`) the branch path returns a 404 page. The fallback to the multibranch root returns only `{"_class":"…WorkflowMultiBranchProject"}`, because the `tree=builds[…]` filter strips `jobs`, so the `has("jobs")` test never matches. `body` stays empty and the function exits 4.

Effect: fleetd cannot read the default branch's CI. No `default-branch.json` is written, the `default-branch-red` hold never acts, and nothing warns. No config key points the default branch at another Jenkins job.

## Design

### Approach

1. **A missing branch answers empty.** When the root answers with a multibranch `_class` and no `builds`, `jenkins_sha_runs` treats the branch as absent: `run-for-sha` and `runs` print an empty answer and exit 0. A 404 on the branch path and a root that did not answer at all stay exit 4, so an unreachable Jenkins is still distinguishable from "no such branch".
2. **A way to name the default branch's job.** Either a `## Plot Config` key (for example `Default branch job`, read through `plot-config.sh`) that `jenkins_sha_runs` uses in place of the multibranch branch path, or a warning that names the missing branch job. Which of the two is an open question below.
3. **A visible hold reason.** When fleetd gets no reading for the default branch, the board or the fleet log names the cause. Today the absence is silent.

Board impact: none expected for the plan format; the `default-branch-red` hold reads the same file.

### Open Questions

- [x] Config key, message only, or both? Both: a `Default branch job` key plus a warning. A new `## Plot Config` row in `skills/plot/scripts/plot-config.sh` documents it; a message alone would have left ewz-kus-portal with no default-branch CI reading, which is the failure being fixed.
- [x] Should the key name one job for the default branch only, or a branch-to-job map? One job. The field test shows one case; a map is a surface nobody has asked for.
- [x] Does the empty answer for an absent branch change what `plot-ask.mjs merge` does? No. `defaultBranchRed(null, ...)` already returns `false` — a missing reading holds nothing — and `packages/domain/test/default-branch.test.ts` already asserts it; the `'unreadable'` outcome writes no file, so this path was already covered rather than needing a new test.

## Slices

### Jenkins default branch job

- `bug/jenkins-run-for-sha-on-the` — `jenkins_sha_runs` answers empty for a branch the multibranch job lacks, and the default branch can name its own job <!-- builds: a Plot Config key for the default branch's Jenkins job --> → #2306

## Notes

- Related and already delivered: `2026-10-21-jenkins-run-for-sha-can-answer` (#2214), which drops `NOT_BUILT` builds in the same function.
- Created by `/plot-idea` from issue #2278, unattended: the design question was not answered, so the plan starts in Draft.
