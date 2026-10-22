# Board hides a green draft slice PR that waits for a person to mark it ready

> A slice PR that is a draft, has green checks and has no live agent appears nowhere on the board, and the payload reads its checks as `pending` while the host reads them green.

## Status

- **State:** Approved
- **Sprint:** bugfix-2-28-1
- **Type:** bug
- **Issue:** #2319
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-22, Jan Wloka, plan-PR #2320 merged
- **Started:** 2026-10-22, Jan Wloka, `bug/board-hides-a-green-draft-slice`

## Changelog

- A draft slice PR with green checks and no live agent appears in *Waiting on you* with the action "mark ready".
- The payload's `checks` reading for such a PR follows the host.

<!-- Board impact: changes board row placement and the PR checks reading in the board payload. No change to the plan format, template, helper scripts or docs/plans layout. -->

## Motivation

Measured 2026-10-22 on slice PR #2310 (`bug/reconcile-on-bitbucket-reads-merged-branches`): a draft with all four CI checks green on head `1173b7f34`, waiting only for a person to mark it ready. The board showed it nowhere:

- *Waiting on you* held no row for it.
- *Working* held no row, because its desk had finished and waited for new work.
- The plan's row read "in progress 0/1".
- The payload held the PR under the plan's `prs[]` with `checks: "pending"`, while GitHub reported all four checks green.

The operator asked "I don't see 2310" and received the link from the master agent. Source: issue #2319, found during the W42 sprint, ewz-kus-portal round 6 follow-up.

Two defects appear in one payload: a placement gap (no section claims a draft slice PR whose agent has stopped) and a checks reading that disagrees with the host on the same head.

## Design

### Approach

Fix the two defects separately and prove each against the #2310 shape.

1. **Placement.** A slice PR that is a draft, has green checks and has no live agent gets a *Waiting on you* row with the action "mark ready". The decision belongs in the domain, so a unit test asserts the section without a browser (see *Every rendered state is a domain property* in CLAUDE.md).
2. **Checks reading.** Find why the PR index or the pass that fills `prs[].checks` reads `pending` on a head the host reads green, and make the reading follow the host. The cause is not yet known; it may be a stale index row, a cadence gap for draft PRs, or a rule that treats draft checks as pending.

Related earlier work on placement: `2026-10-15-waiting-on-you-lists-a-draft` (a Draft *plan's* slices) and `2026-10-02-a-draft-slice-waits-on-its-approval`. Both concern slices of a Draft plan, not a draft slice PR of an approved plan.

### Open Questions

- [ ] Why does `prs[].checks` read `pending` while the host reads green? Reproduce on a draft PR before choosing the fix.
- [ ] Does "no live agent" include an agent whose desk finished, as in #2310? Name the process states that count.
- [ ] Does a draft with red or pending checks also need a row, or only the green one the issue names?

## Slices

### Show the green draft

- `bug/board-hides-a-green-draft-slice` — place a green draft slice PR with no live agent in Waiting on you with the action "mark ready", and make the payload's checks reading follow the host

## Notes

Created from tracker issue #2319 by `/plot-idea`, unattended. Type given in the prompt; State stays Draft because the prompt gave no design answer. Ceremony: `Plan PRs: required` gives `Review: pr`; code repo gives `Impl: own branches`. Nothing was written to the tracker.
