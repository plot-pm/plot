# Jenkins: a sha-bound run reports the merge base as its sha

> Under `CI: jenkins` with merge-before-build, `plot-host.sh runs-for-sha` matches the right build but reports `.sha` as the tip of the target branch, because `jenkins_sha_runs` takes the first of the build's two `lastBuiltRevision` entries. `runs` also lists `NOT_BUILT` and `ABORTED` builds as runs.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:**
- **Issue:** #2153
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-20, Jan Wloka, plan-PR #2165 merged
- **Started:** 2026-10-20, Jan Wloka, `bug/a-sha-bound-run-reports-the`

## Changelog

- Jenkins: a run returned for a sha reports that sha in `.sha`, not the merge base of a merge-before-build job.
- Jenkins: `runs <branch>` no longer lists `NOT_BUILT` and `ABORTED` builds as runs.

Board impact: none expected. `plot-jenkins-pr-checks.mjs bind` takes `checksSha` from the sha the caller asked for, not from the row's `.sha`. Slice 1 confirms this by reading every consumer of `.sha`.

## Motivation

Field test on 2026-10-20 against ewz-kus-portal (Bitbucket + Jenkins, multibranch job with merge-before-build). Every Jenkins build carries two `lastBuiltRevision` entries: the first is the tip of `develop`, the second is the branch head.

`plot-host.sh runs-for-sha bug/fix-kafka-topic-name 66836536f8c9…` matches the correct build, because the match uses `any(shas)`. The row's `.sha` reads `bd70636876302e7974b84ff8a7e947d068c485cd`, the tip of `develop`.

The cause is `map(.sha = (.shas | first // ""))` at the end of `jenkins_sha_runs` (`skills/plot/scripts/plot-host.sh`, near line 1782). A reader that compares `.sha` with the head it asked about sees a mismatch on a build that matched.

A second defect, seen in the same test: `runs <branch>` lists `NOT_BUILT` and `ABORTED` builds. Neither is a run of the branch's code.

## Design

### Approach

1. **`.sha` names the sha that matched.** When the caller passes a sha, `jenkins_sha_runs` sets `.sha` to the entry of `shas` that the match selected (exact or prefix), not to `first`. With no sha (`runs`), `.sha` reads the branch head: the entry whose `lastBuiltRevision.branch` names the branch, falling back to the last entry. The fix stays inside the jq program of `jenkins_sha_runs`, the one place that reads `lastBuiltRevision`.
2. **`runs` drops builds that did not run.** `NOT_BUILT` and `ABORTED` results are removed before the limit applies. This decision is open (see below), because `ABORTED` can carry a real cancellation signal for a caller.
3. **Tests.** A fixture with two `lastBuiltRevision` entries per build, in `test/reconcile/host.test.mjs`, asserts `.sha` for `run-for-sha`, `runs-for-sha` and `runs`. The fixture makes the two entries differ, so `first` and the matched entry disagree.

Related plans, all Delivered or Approved on the same arm: `2026-10-18-bitbucket-jenkins-pr-list-binds-a`, `2026-10-19-jenkins-checks-never-bind-to-the`, `2026-10-20-bitbucket-jenkins-pr-list-rows-past`. This plan overlaps them in files and not in scope.

### Open Questions

- [x] For `runs` with no sha, which entry is the branch head: the one whose `branch` matches the branch name, or the last one? **Answered by fixture, not by a real ewz-kus-portal payload** — no live build payload was available to this run. The fix reads the entry whose `lastBuiltRevision.branch` names the asked branch, falling back to the last entry when no action names it. `host.test.mjs` pins both arms directly against `jenkins_sha_runs`, since no CLI op prints `.sha` for a no-sha lookup (see below).
- [ ] Does any consumer of `.sha` (BuildMonitor, `plot-jenkins-pr-checks.mjs`) rely on the current merge-base value?
- [x] Should `ABORTED` drop out of `runs`? **Yes — no concrete consumer reads it as a signal.** `grep -rn "conclusion" packages/ skills/plot/scripts/board/` turned up one `runs`-output reader, `runOf` in `packages/domain/src/adapters/build/build-shell.ts`, which passes `conclusion` through verbatim and documents it as such ("The conclusion is passed THROUGH rather than read against a set") — nothing compares it to `ABORTED` or any other value. `runs` drops both `NOT_BUILT` and `ABORTED`, matching the Changelog entry.
- [ ] Does the `runs` filter belong in this plan or a separate one? It is a separate defect with a separate consumer.

**Discovery (slice 1):** `run-for-sha`/`runs-for-sha` take their sha via `${1:?$op needs a sha}`, which errors on an empty string as well as an unset argument — no CLI op can call `jenkins_sha_runs` with an empty sha. `runs` is the only no-sha caller, and it drops `.sha` from its own output before printing (`{workflow,conclusion,startedAt,url}`). So no CLI surface prints `.sha` for a no-sha lookup today; the branch-head arm is tested by sourcing `jenkins_sha_runs` directly (with `exit` stubbed to `return`, the way `prMergedLib` sources `plot-pr-merged.sh` elsewhere in `host.test.mjs`) rather than through a CLI op.

## Slices

### Sha Of A Run

- `bug/a-sha-bound-run-reports-the` — `jenkins_sha_runs` reports the matched sha in `.sha`; fixture test with two `lastBuiltRevision` entries → #2173 <!-- builds: jenkins_sha_runs matched-sha reading -->

### Runs That Ran

- `bug/jenkins-runs-skip-builds-that-did` — `runs` omits `NOT_BUILT` and `ABORTED` builds; test per result value <!-- waits: bug/a-sha-bound-run-reports-the -->

## Notes

- Source: issue #2153, filed from the 2026-10-20 field test on ewz-kus-portal.
- Both slices edit the same jq program in `plot-host.sh`, so the second waits for the first.
