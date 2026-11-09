# restart refuses a slice whose dead agent left a draft PR

> `restart` reads any open PR as "the work reached review", so a slice whose agent ended and left an incomplete draft PR gets no new agent from any controller.

## Status

- **State:** Delivered
- **Type:** bug
- **Sprint:** ship-2-32-0
- **Issue:** #3293
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-09, Jan Wloka, plan-PR #3294 merged
- **Started:** 2026-11-09, Jan Wloka, `bug/restart-a-slice-whose-dead-agent-left-a-draft-pr`
- **Delivered:** 2026-11-09

## Changelog

- `plot-restart-command.mjs` starts a new agent on a slice whose PR is a draft and whose worker is dead. It still refuses a non-draft open PR with `reached-review`.

<!-- Board impact: none. No plan format, template, helper script or docs/plans layout changes. -->

## Motivation

A slice whose agent ended and left an incomplete draft PR waits with nobody on it. Measured 2026-11-08/09 on `feature/delivery-tab-sections` (PR #3267, draft, body "first slice only"), every route refused:

| Route | Answer |
|---|---|
| fleet reading | `startability: someone-is-on-it`, `group: quiet`, "nobody is on it — last commit 5 hours ago" |
| `plot-restart-command.mjs` with no local worktree | `no-worktree` |
| `plot-restart-command.mjs` after a worktree was added | `reached-review: … has a pull request (#3267, OPEN) — the work reached review` |
| `plot-continue-command.mjs` | `no-question: no unanswered PLOT-BLOCKED marker` |
| `plot-dispatch-command.mjs` / `POST /api/dispatch` | `implement-started`: books the brief again and starts no worker |
| `plot-dispatch.sh --release` | refuses a branch that carries real work |

Five Delivery tab slices wait on this one. A draft PR is not in review: no reviewer or merge acts on a draft, and the fleet's review arm skips it.

## Design

### Approach

The prState reading in `packages/fleet/src/shared/restart-command.ts` (the `reachedReview` answer, around line 70) returns the PR's number and state but not its draft flag. The reading carries `draft`, and `restartWorker` in the domain (`packages/domain/src/workflows/dispatch.ts`) refuses `reached-review` only where the PR is open and not a draft.

A slice with an open draft PR, no live worker and no `PLOT-BLOCKED` marker restarts. The other refusals (`loop-alive`, `worker-alive`, `worker-finished`, `blocked-marker`, `unattended`, `pr-unanswerable`) stay. The new agent continues on the existing branch and PR, and reads the brief and the PR body's Not done list.

The decision stays in the domain, per the layering rule: the controller passes the draft flag as a reading, and a unit test asserts the refusal without a host.

### Open Questions

- [x] Does the fleet reading's `someone-is-on-it` / `quiet` answer for the same slice need a change, or does the restart fix suffice? → The restart fix suffices. The `quiet` row already tells a person that nobody is on the slice; what was missing is a controller that acts on it. A change to the fleet reading is out of scope.
- [x] Does the restart brief already name the PR body's Not done list, or does the brief builder need a line for it? → It needs a line. The restart prompt (`packages/fleet/src/shared/restart-command.ts:20`) says only "Read the brief, the tree and `git log`". When the slice has an open draft PR, the prompt also names the PR number and tells the agent to read its body and finish its Not done list. The slice's test asserts that line.

## Slices

### Restart a draft-PR slice

- `bug/restart-a-slice-whose-dead-agent-left-a-draft-pr` — carry the PR's draft flag into the restart decision and refuse `reached-review` only for a non-draft open PR; tests cover a draft PR with a dead worker (restarts) and a non-draft open PR (refuses `reached-review`) → #3300

## Notes

Issue: https://github.com/plot-pm/plot/issues/3293. Related, released: `no-controller-restarts-a-stopped-slice` (#2784) added the restart controller.
