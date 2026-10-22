# Jenkins runs lists every build twice for a plain job

> `plot-host.sh runs` prints one line per `lastBuiltRevision` match instead of one line per build when the job is a plain (non-multibranch) Jenkins job.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:**
- **Issue:** #2322
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-22, Jan Wloka, plan-PR #2331 merged
- **Started:** 2026-10-22, Jan Wloka, `bug/jenkins-runs-lists-every-build-twice`

## Changelog

- `plot-host.sh runs` lists each Jenkins build of a plain job once.

<!-- Board impact: none. The change is inside one helper script's jq program; no plan format, template or docs/plans layout changes. -->

## Motivation

On ewz-kus-portal with `PLOT_JENKINS_JOB=kus-portal/continuous-deploy`, `plot-host.sh runs develop` prints 8 lines for 4 unique builds. The ewz field test (round 7, main `da789acff`) found it read-only. The defect shows only when the `Default branch job` key (#2278) or the env override names a plain job.

A consumer that counts runs, or takes the first N, reads each build twice.

## Design

### Approach

In the no-sha path, `plot-host.sh` (the `map(.sha = ... headsha($branch) ...)` line, 1868 on main `592109f2b`) assigns `.sha` from `headsha($branch)`. `headsha` ends in `[.br, .shas] | transpose[] | select(.[0] == $b) | .[1]`, a generator: it emits one value per matching pair. A build of a plain job carries two `lastBuiltRevision` entries for `develop`, so the assignment emits two objects for that build. The sha paths do not use this arm and are not affected.

The fix makes `headsha` return one value: take the first match with `first(...)` (the `// (.shas | last // "")` fallback then applies when there is no match). Open choice: first match or last match. A build's two entries name the same branch, so they are expected to carry the same SHA; the test pins that assumption.

The comparison corpus in `test/reconcile/host.test.mjs` gets a fixture with a plain-job build holding two `develop` revisions, asserting one output line per build.

### Open Questions

- [ ] Do the two `lastBuiltRevision` entries of one build always carry the same SHA? If not, which one is the build's head?
- [ ] Does the sha path need a guard against the same generator, or does `startswith` filtering already make it a single value?

## Slices

### Fix

- `bug/jenkins-runs-lists-every-build-twice` — make `headsha` emit one value per build, with a regression fixture

## Notes

- Source: tracker issue #2322. Nothing was written to the tracker.
- Related: #2278 (`Default branch job`).
