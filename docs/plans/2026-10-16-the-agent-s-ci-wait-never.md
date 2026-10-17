# Jenkins CI: the agent's CI wait never settles, and no Jenkins check binds to a commit

> A Jenkins build result never reaches the fleet agent's CI wait as a settled word, and no Jenkins PR check names the commit it measured.

## Status

- **State:** Approved
- **Sprint:** bitbucket-jira-and-jenkins-work-with-the-board
- **Type:** bug
- **Issue:** #1867
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-16, Jan Wloka, plan-PR #1868 merged
- **Started:** 2026-10-16, Jan Wloka, `bug/jenkins-run-for-sha-conclusion`
- **Started:** 2026-10-17, Jan Wloka, `bug/jenkins-credential-from-env`
- **Started:** 2026-10-17, Jan Wloka, `bug/jenkins-pr-checks-bind-to-head`

## Changelog

- Fix: on Jenkins, the agent's CI wait settles on `build passed` or `build failed` instead of ending `checks-unanswered` after `Checks wait`.
- Fix: Jenkins PR rows bind their checks to the head commit, so a new push no longer shows the previous build's colour.
- Fix: the default-branch red hold works on Jenkins when `Default branch checks` is set.
- Jenkins REST credentials read from the environment or `.env` as well as the macOS keychain.

<!-- Board impact: none for the plan format, template or docs/plans layout. Slice 3 changes the `checks` and `checksSha` fields that `pr-list` and `pr-state` emit, which the board renders through `checks-reading.ts`; rebuild the board artifact if that contract moves. -->

## Motivation

An audit of `origin/main` at `36cb3f860` (2026-10-16) against the sprint goal *a project hosted on Bitbucket, tracked in Jira and built on Jenkins works with the board as well as a GitHub project* found ten Jenkins gaps with no open issue. Issue #1867 lists them. Three of them fail silently:

- **The CI wait never settles (gap 1).** `run-for-sha`'s Jenkins arm prints Jenkins' own `result` word (`SUCCESS`, `FAILURE`) at `plot-host.sh:1726-1727` and `:4540`. `buildJenkins.runForSha` passes it through unmapped (`build-jenkins.ts:107-108`), while `runsForSha` maps it with `jenkinsConclusion` (`:116`). `checksFromRuns` settles only on lowercase `success`, `failure` and `action_required` (`checks-verdict.ts:137`, `:218`), and `checksPassed` compares with `'success'` (`worker-loop.ts:884`). A finished Jenkins build therefore reads as *no run*, and every fleet agent waits the full `Checks wait` (3600 s) before it ends `checks-unanswered` with a `PLOT-BLOCKED` marker (`agent-loop.ts:878-881`). No `build passed` or `build failed` finding is published and a red build writes no `PLOT-CORRECTION.md` entry. No test covers `buildJenkins().runForSha` with a Jenkins result word.
- **A Jenkins PR row names no commit (gap 3).** `jenkins_build_map` reads one colour per branch (`plot-host.sh:1564-1590`). Between a push and the start of the new build, the row keeps the old `green` for the new head, and the IndexMonitor publishes `checks green` (`index-findings.ts:68-76`).
- **The default-branch red hold never fires (gap 5).** `jenkins_sha_runs` emits no `workflow` field (`plot-host.sh:1722-1729`), so `declaredRuns` drops every run (`default-branch.ts:44`). The fold of no runs is `unknown`, so `plot-ask merge` permits merges on a red main.

The remaining gaps refuse by name or sit outside the sprint's combination, and are listed under Slices.

Earlier plans built the Jenkins connector and its job-shape reading (`2026-09-08-the-ci-connector-is-jenkins`, `2026-09-15-a-jenkins-job-is-read-by-its-shape`, both Released). This plan fixes what those plans left unbound; it does not replace them.

## Design

### Approach

The gaps share one cause: the Jenkins arms return Jenkins' vocabulary and shapes where the domain expects the host-neutral ones (lowercase conclusions, a `workflow` name, a `checksSha` bound to a head). Each slice moves one mapping to the adapter edge, per the layering rule in `CLAUDE.md`, and adds a test at the port.

1. **Gap 1 first, as the tracer.** `buildJenkins.runForSha` maps the conclusion through `jenkinsConclusion`, like `runsForSha`. A worker-loop test with a `SUCCESS` and a `FAILURE` fixture settles to `build passed` and `build failed`.
2. **Gap 7 next.** `jenkins_rest_credential` also reads `JENKINS_USER` and `JENKINS_API_TOKEN` from the environment or the repository's `.env`, as the Jira connector reads its own. Without it, no Linux machine reaches gap 1's fix.
3. **Gaps 5, 3, 4 and 10: bind every Jenkins reading to a commit.** The Jenkins arm emits `workflow` as the job path; open PR rows emit `checksSha` and read `pending` or `unknown` where the colour cannot bind to `headSha`; a plain pipeline is read by head sha through `jenkins_sha_runs`'s existing plain-job fallback (`plot-host.sh:1711`); `aborted` maps to `unknown` as the run-level mapping does. A declared `Default branch checks` name that matches no run is reported.
4. **Gaps 2, 6 and 8: merge-on-green for Bitbucket + Jenkins.** The Bitbucket arms of `pr-state` return `headSha`, `checks` and `checksSha`, read from the Jenkins build for `source.commit.hash` or from Bitbucket commit build statuses (`GET /2.0/repositories/{workspace}/{repo_slug}/commit/{sha}/statuses`). `pr-review` reads the `plot/review` status from the same endpoint. Under `CI: jenkins`, `pr-state` uses the same check source as `pr-list`. Pinning the merge follows #1556 and stays out of this plan.
5. **Gap 9, low priority.** The `runs` op reads the job's builds with timestamps and URLs.

Wave order follows the dependency: gap 1 and gap 7 are independent and run first; gaps 2, 6 and 8 need the commit binding that gaps 3 and 5 establish.

### Open Questions

- [ ] Should gaps 2, 6 and 8 split into a second plan? They add a Bitbucket read source and touch the host connector tracked by #1848.
- [ ] Gap 3: when a colour cannot bind to the head, is `pending` or `unknown` the right word? `pending` holds a merge queue; `unknown` does not.
- [ ] Gap 7: does the `.env` read belong to `plot-host.sh` or to a shared credential helper the Jira connector already uses?

## Slices

### Tracer

- `bug/jenkins-run-for-sha-conclusion` → #1895 — map the Jenkins result word in `buildJenkins.runForSha` and cover the wait with a worker-loop test (gap 1) <!-- builds: jenkinsConclusion mapping in buildJenkins.runForSha -->

### Credentials and default branch

- `bug/jenkins-credential-from-env` → #1936 — read the Jenkins REST credential from the environment or `.env` (gap 7)
- `bug/jenkins-default-branch-workflow` → #1937 — emit `workflow` as the job path and report an unmatched declared name (gap 5)

### Commit binding

- `bug/jenkins-pr-checks-bind-to-head` — bind PR row checks to `headSha`, read plain pipelines by sha, map `aborted` and `notbuilt` (gaps 3, 4, 10) <!-- waits: bug/jenkins-default-branch-workflow -->

### Bitbucket and GitHub readings

- `feature/bitbucket-pr-state-binds-checks` — Bitbucket `pr-state` and `pr-review` return a head-bound check word; `pr-state` follows `pr-list`'s source under `CI: jenkins` (gaps 2, 6, 8) <!-- waits: bug/jenkins-pr-checks-bind-to-head -->
- `bug/jenkins-runs-history` — the `runs` op returns builds with timestamps and URLs (gap 9)

## Notes

- Source: issue #1867 (https://github.com/plot-pm/plot/issues/1867). The plan writes nothing to the tracker.
- Deliverable search for `jenkinsConclusion`: it exists at `build-jenkins.ts:22` and is applied at `:116` only. The tracer extends its use and builds no new helper.
- Related Released plans: `2026-09-08-the-ci-connector-is-jenkins`, `2026-09-15-a-jenkins-job-is-read-by-its-shape`.
- Definition of Done: docs/definition-of-done.md
