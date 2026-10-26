# A slice PR left as a draft by a finished agent never becomes ready

> A slice PR that its agent opened as a draft stays a draft after the agent finishes, because no controller, worker loop or fleetd step marks it ready.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** follow-ups-2-28-3
- **Issue:** #2559
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2561 merged
- **Started:** 2026-10-24, Jan Wloka, `bug/a-slice-pr-left-as-a`

## Changelog

- When an agent's run ends `finished` and its branch has an open draft slice PR whose head is the agent's last push, the worker loop marks the PR ready through `plot-host.sh pr-ready`. A draft whose agent ended `failed`, `ended`, `stalled` or `waiting` stays a draft.

<!-- Board impact: none expected. The board row for a green draft with no live agent ("mark ready", `awaitsMarkReady`) stays as the fallback for drafts the loop leaves alone. Confirm once the rule exists. -->

## Motivation

PR #2550 (`bug/board-status-banner-states`, plan `board-status-banner-offline-tickets-and`) opened as a draft at 2026-10-24T13:19Z. All four checks passed at 13:37Z. The desk was gone by 14:10Z and the PR was still a draft. The sibling slice `bug/board-offline-tickets-age-and-rows` waits on that branch, so the plan stops behind one stranded draft. PRs #2468 and #2422 are older draft slice PRs.

The draft comes from the brief template ("Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves)") and from `skills/plot-implement/SKILL.md:315`. `plot-host.sh pr-ready` exists (`plot-host.sh:4204`), and only the approve workflow calls it, for plan PRs (`packages/domain/src/workflows/approve.ts:346`). `awaitsMarkReady` (`packages/domain/src/rules/pr-row.ts:97`) only shows a "mark ready" row on the board, so a person still runs `gh pr ready`.

## Design

### Approach

1. A domain rule decides: given the agent's worker state, the PR's draft flag, and whether the PR head equals the agent's last push, answer whether to mark the PR ready. It answers yes only for `finished` with an open draft whose head is the agent's last push. `failed`, `ended`, `stalled`, `waiting`, `running`, `none` and `elsewhere` answer no.
2. The worker loop performs the decision after the run ends, through `plot-host.sh pr-ready <number>` (the loop never calls `gh`; `check-host-cli-callers.sh` gates that).
3. The rule joins the corpus tier if the loop duplicates it in shell, per `docs/shell-and-domain.md`: `plot-worker-loop.sh` runs once per agent per pass, the case that document allows to duplicate with a corpus comparison.
4. A test covers each worker state and the head-mismatch case (the PR head moved after the agent's last push).

### Open Questions

- [ ] Should the brief template and `skills/plot-implement/SKILL.md:315` keep recommending `--draft`, or open ready PRs once the loop owns the transition?
- [ ] Does "marks ready" belong in the worker loop or in fleetd's PR pass? The loop sees the agent's last push directly. fleetd reads the PR index.
- [ ] Should the mark-ready wait for green checks? A ready PR with red checks may trigger reviewers earlier than the board's `awaitsMarkReady` row does.
- [ ] Does a failed `pr-ready` call block the loop's exit or only log?

## Slices

### Fix

- `bug/a-slice-pr-left-as-a` — domain rule for marking a finished agent's draft ready, and the worker loop step that performs it <!-- builds: markReadyDecision, a domain rule for finished agents' draft PRs --> → #2587

## Notes

- Source: https://github.com/plot-pm/plot/issues/2559
