# Jenkins run-for-sha can answer a NOT_BUILT build

> Under `CI: jenkins`, `plot-host.sh run-for-sha` and `runs-for-sha` can return a `NOT_BUILT` build as the run for a sha, so a head whose only build is `NOT_BUILT` reads as completed/`NOT_BUILT` instead of "no run".

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #2214
- **Review:** pr
- **Impl:** own branches

## Changelog

- Jenkins: `run-for-sha` and `runs-for-sha` skip `NOT_BUILT` builds, as `runs` does. A head whose only build is `NOT_BUILT` reads as "no run".

## Motivation

Jenkins records two `lastBuiltRevision` shas on some builds (ewz-kus-portal, `EWZREL-13094` build 7). A sha-bound lookup matches such a build on either sha. When that build's result is `NOT_BUILT`, the lookup returns it as the run for the sha: `status: completed`, `conclusion: NOT_BUILT`.

#2181 removed `NOT_BUILT` and `ABORTED` from `runs` and left the sha arms alone. In `jenkins_sha_runs` (`skills/plot/scripts/plot-host.sh`, near line 1800) the filter is applied only when `$sha == ""`.

Measured read-only on main 01a6cf2ad, 2026-10-21. No current PR head shows it.

## Design

### Approach

1. **The sha arms drop `NOT_BUILT`.** `jenkins_sha_runs` removes `NOT_BUILT` builds before the sha match, for the sha-bound and the unfiltered call alike. The fix stays inside the jq program of `jenkins_sha_runs`, the one place that reads `result`.
2. **Tests.** A fixture in `test/reconcile/host.test.mjs` holds a build with two `lastBuiltRevision` entries and `result: NOT_BUILT`, plus a head with a second, real build. `run-for-sha` and `runs-for-sha` return no run for the first head, and the real build for the second.

### Open Questions

- [ ] Does `ABORTED` drop out of the sha arms too? #2181 dropped it from `runs`, and the reported defect names only `NOT_BUILT`. An aborted build of a head can be a real cancellation signal for a caller that asks about one sha.
- [ ] Does any consumer rely on the `NOT_BUILT` row (BuildMonitor, `plot-jenkins-pr-checks.mjs bind`, `build-shell.ts`)? `build-shell.ts` passes `conclusion` through without reading it; the other two need a check.

## Slices

- `bug/jenkins-run-for-sha-can-answer` — skip `NOT_BUILT` in the sha arms of `jenkins_sha_runs`, with the two-revision fixture

## Notes

Related plan on the same arm: `2026-10-20-a-sha-bound-run-reports-the` (Delivered, #2181).
