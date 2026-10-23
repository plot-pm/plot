# plot-approve names a refused listing, not a missing PR

> `plot-approve` reports «no PR found» and «no plan found» when the host refused the open-PR listing, and the repair advice it prints creates a duplicate plan.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** bugfix-2-28-2
- **Issue:** #2407
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2417 merged
- **Started:** 2026-10-23, Jan Wloka, `bug/plot-approve-reports-no-pr-found`

## Changelog

- `plot-approve` no longer reports «no PR found» or «no plan found» when the host refused the PR listing. It reports that the host could not be asked, gives the host's reason, and says to re-run once the host answers.

Board impact: none. The change touches the approve entry and its refusal text only.

## Motivation

Observed 2026-10-23 in ewz-kus-portal (Plot 2.28.0, Bitbucket, bb 1.11.2). The plan sits on a batch plan PR (`idea/kus-portal-103-jan-plaene`, #3719, open, not draft). `plot-approve` asks for the PR of `idea/<slug>`, finds none, and falls back to listing the open PRs. `pr-list` answered HTTP 429 (`host refused a burst`), and the run ended with one of two refusals:

- from the idea worktree: `no PR found for branch 'idea/<slug>'. Push the branch … Then open its PR — or run /plot-idea`
- from the default-branch checkout: `no plan found for '<slug>' — looked in … and on the heads of the open PRs. … Or create the plan first: /plot-idea`

`plot-host.sh pr-list --state open` run right afterwards printed `host refused a burst — HTTP 429` and `no state answered; this is not a partial answer`.

Other paths in the same entry already answer correctly: `the host could not be asked for the PR of '<branch>' (plot-host.sh pr-state refused the call)` (`readPlanPr`) and `the host could not list its open PRs …` (`openPrsOf`). The two fallback paths do not. Their repair advice (push the branch, create the plan, `/plot-idea`) makes a user create a duplicate plan for a plan that exists.

An absent answer is not a false answer. A listing the host refused says nothing about whether the PR or the plan exists.

## Design

### Approach

`packages/board/src/server/entry/approve.ts` holds both refusals and both correct paths. Two places are suspect, and the first step of the slice confirms which one fires before any fix:

1. `choosePlanPr` throws `Refused` from `openPrsOf`. The caller catches it into `hostRefusal`, substitutes `{ number: 0, state: 'OPEN' }` and continues so that phase and review-channel refusals keep their precedence. If the held refusal is dropped on a path where the domain then answers `plan-not-found` or no-PR, the entry prints `refusalText` for the domain's reason and the host's reason never surfaces.
2. The remote-plan lookup (`openPrsOf` at the call in the default-branch checkout path) can treat a listing that failed as an empty list, so `plan-not-found` fires.

The rule for the fix: when a host call that could have produced the PR or the plan was refused, the entry prints the host refusal (`hostSaid`) with «re-run once the host answers», and prints `plan-not-found` or the no-PR text only when every listing answered and none held the plan.

The slice starts with a failing test: a host stub whose `pr-state` finds no PR for `idea/<slug>` and whose `pr-list --state open` refuses, run from both checkouts. The test asserts the output names the refusal and contains neither «no PR found» nor «no plan found». The same cases cover `plot-needs-design`, which shares the lookup shape (`entry/needs-design.ts:183`), and the check confirms whether it has the same gap.

### Open Questions

- [ ] Which of the two suspect paths fires in the reported run, or both?
- [ ] `plot-needs-design` and `plot-deliver` print similar «no PR found» text. Does either carry the same gap, and does it belong to this slice or to its own?

## Slices

### Refused listing is named

- `bug/plot-approve-reports-no-pr-found` — approve reports «could not ask» with the host's reason when the open-PR listing was refused, from both checkouts.

## Notes

- Source: issue #2407, observed in ewz-kus-portal on 2026-10-23.
- The plan writes nothing to the tracker; the `Issue:` field is the only link.
