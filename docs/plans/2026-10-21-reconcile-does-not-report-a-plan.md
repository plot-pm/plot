# Reconcile does not report a plan linked in both active and delivered

> Reconcile §1 reads a plan linked in both index directories as consistent, so a plan with a stale second link produces no drift line and no fix command.

## Status

- **State:** Approved
- **Sprint:** bitbucket-jira-and-jenkins-work-with-the-board
- **Type:** bug
- **Issue:** #2284
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2293 merged
- **Started:** 2026-10-21, Jan Wloka, `bug/reconcile-does-not-report-a-plan`

## Changelog

- `/plot-reconcile` reports a plan that has a symlink in both `docs/plans/active/` and `docs/plans/delivered/`, and prints the command that removes the link its phase does not belong to.

<!-- Board impact: none expected. The change is one scan section and its output; the plan format and the docs/plans layout are unchanged. Confirm during design that no board view reads the §1 drift lines. -->

## Motivation

On ewz-kus-portal, `docs/plans/active/` links two Released plans (`bo-gp-sofort-nachladen`, `ewzkus-3845-gpsync-abloesen`) that `docs/plans/delivered/` also links. Reconcile §1 and §12 report no drift (found by the read-only ewz field test, round 6, on main `b33d3ee22`).

Cause, by reading the code: every §1 drift arm in `skills/plot/scripts/plot-reconcile-scan.sh` tests one link present and the other absent. The delivered/released arm requires `in_active && !in_delivered`, and the draft/approved arm requires `in_delivered && !in_active`. A plan with both links satisfies neither arm. §12 reports only a missing link, so it does not see the second link either.

Source: [#2284](https://github.com/plot-pm/plot/issues/2284).

## Design

### Approach

Add one case to the §1 loop: `in_active` and `in_delivered` both set. The phase decides which link is stale:

- `delivered`, `released`, `superseded`, `rejected`: the plan belongs in `delivered/`, so the fix removes the `active/` link.
- `draft`, `approved`: the plan belongs in `active/`, so the fix removes the `delivered/` link.

The line names the plan, the phase and both links, and prints `fix: git rm <stale link> && git add -A`. The scan prints the command and runs none. The case counts in `n_drift` like the other §1 arms.

### Open Questions

- [ ] Which `active/` or `delivered/` link a plan in a phase outside the two lists above (for example `design`) keeps. The existing arms skip those phases, so the proposal is to report the double link without a fix command.

## Slices

### Double link

- `bug/reconcile-does-not-report-a-plan` — add the both-linked case to §1 of `plot-reconcile-scan.sh`, with a `test/reconcile/` test that builds a Released plan linked in both directories and a Draft plan linked in both, and asserts the drift line and the fix command for each. <!-- builds: a both-indexes drift case in reconcile scan section 1 -->

## Notes

Definition of Done: `docs/definition-of-done.md`. Deliverable search for "reconcile plan linked in both active and delivered" found no existing artifact.
