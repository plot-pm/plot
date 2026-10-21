# Reconcile §23 checks no plan under a Jira tracker

> Under `Tracker: jira`, reconcile §23 prints "not evaluated" for every plan; it reads each plan's Jira key and checks it against the tracker instead.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** bitbucket-jira-and-jenkins-work-with-the-board
- **Issue:** #2249
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2256 merged

## Changelog

- `/plot-reconcile` section 23 checks finished plans against a Jira tracker and names each plan whose key it cannot find.

<!-- Board impact: none. The plan format and the board's parse do not change; only reconcile's §23 reads a key the plan already carries. -->

## Motivation

`plot-reconcile-scan.sh` §23 ("a finished plan's issue is still open") prints `(not evaluated — plan Issue: numbers cannot be matched to Jira keys)` on every Jira project and checks no plan. Issue #2249 measured 6 unchecked plans on ewz-kus-portal (plot main `be96cdfe4`, 2026-10-21, read-only, `Tracker: jira`). The "issue still open after delivery" check therefore never runs where the tracker is Jira.

The refusal was deliberate: `plot-plan-meta.sh` parses `Issue: #N`, so numbers never match Jira keys, and a clean result would be a false negative. The cause is that the plans on a Jira project already carry the key (`Issue:` line or `ticket:` frontmatter, as in the sprint/Release comparison), and §23 does not read it.

## Design

### Approach

1. Read each finished plan's Jira key from the field the sprint/Release comparison already reads. Reuse that reader; do not add a second parser.
2. Ask the tracker through the existing `board/plot-issue-source.mjs` entry, and compare keys with the returned open set. Keep the three outcomes apart (answer, no tracker, failed question) and keep `--offline`/`--no-pr` behaviour.
3. Name every plan with no key found as "not checked", with a count, so an unchecked plan is never read as clean.
4. §23 stays advisory: it reports `open_issues=`, stays out of `attention=`, and prints no close command.

Duplication rule: if §23 keeps a shell-side key reader beside a domain rule, it joins the corpus tier (`packages/domain/corpus/`) per CLAUDE.md "A Shell Script Asks The Domain".

### Open Questions

- [ ] Which reader holds the Jira key today (the sprint/Release comparison), and is it callable from the scan without a second implementation?
- [ ] Does the Jira issue list return closed issues, or only open ones? Membership meaning "open" depends on it (see the `issue-list` window note in §23).
- [ ] Does the Jira list have a result limit that §23 must state, as `PLOT_ISSUE_LIMIT` does for GitHub?

## Slices

### Jira keys in section 23

- `bug/reconcile-23-checks-no-plan-under` — read each finished plan's Jira key and check it against the tracker in §23; name unchecked plans

## Notes

Source: https://github.com/plot-pm/plot/issues/2249. Created unattended by `/plot-idea`: Review answered `pr` (repo declares `Plan PRs: required`), Impl `own branches`, design question defaulted to no (`State: Draft`).
