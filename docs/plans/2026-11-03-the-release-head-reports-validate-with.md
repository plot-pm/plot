# The release head reports validate with no person approving a run

> The release PR carries a `validate` check that GitHub's ruleset counts on the pinned head, with no person approving a run.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** <!-- optional, filled when plan is added to a sprint -->
- **Issue:** #3073
- **Story:** <!-- optional, story slug this plan is part of (docs/stories/<slug>/) -->
- **Review:** pr
- **Impl:** own branches

## Changelog

- The release PR reports `validate` on its pinned head in what GitHub's ruleset counts, with no person approving a held run, through the mechanism the 2.30.1 measurement selects.

Board impact: none known until the mechanism is chosen. A mechanism that changes how `release-approve` reads the head's checks changes the release row's stage, and the slice records that in its own Board impact line.

## Motivation

The `pull_request` CI run that the changesets bot's release PR triggers waits as `action_required` until a person approves it. GitHub does not count the dispatched run's `validate` check run in the PR's rollup. On 2026-11-03, PR #2934 (release 2.30.0) showed `validate` only after a person approved the held run.

[The release PR needs a person for its review and its CI](2026-11-03-the-release-pr-needs-a-person.md) (issue #3065, plan #3070) records the measurement procedure in its `### CI Measurement` section and names three candidate mechanisms with their costs:

1. A status relayed from the `dispatch-ci` job.
2. A non-bypass token for the changesets action.
3. A controller that approves the held run.

That plan builds Plot's own guard and defers the CI mechanism until a person has measured it on a live release head. Release 2.30.1 cannot be cut while that plan is unfinished, so this slice is planned after the 2.30.1 measurement and not inside #3070.

## Design

### Approach

The mechanism follows from the measurement in #3070's `### CI Measurement`. A person waits for the dispatched `validate`, does not approve the held run, runs `plot-ask.mjs release-approve`, and records Plot's answer and GitHub's answer with timestamps and the rollup at that moment.

- **Outcome A, GitHub merges:** the ruleset accepts the dispatched check alone. This plan then has nothing to build for CI, and the slice closes as "Plot reads the dispatched check", which #3070 owns.
- **Outcome B, GitHub refuses:** a person chooses one of the three candidate mechanisms above, and this plan's slice builds it. The choice and its cost go into `### Decisions` before approval.

Whatever the mechanism, the result is checked on a live release head: `validate` appears in the PR's rollup on the pinned head with no `actions/runs/<id>/approve` call.

### Open Questions

- [ ] What does the 2.30.1 measurement record? Answered by #3070's `### CI Measurement`; this plan stays Draft until that record exists.
- [ ] Which mechanism does the person choose: the relayed status, the non-bypass token or the controller approval?
- [ ] Does the chosen mechanism need a ruleset change, and who holds the right to make it?

## Slices

### Release head validate

- `feature/the-release-head-reports-validate-with` — the chosen mechanism reports `validate` on the release PR's pinned head, proved on a live release head

## Notes

- Source: issue #3073. Refs #3065 and #3070.
- Draft only. The mechanism is not chosen, and the slice is not scoped further until the measurement exists.
