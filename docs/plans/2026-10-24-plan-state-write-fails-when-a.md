# Plan-state write fails when a phase label is missing from the repository

> The `issue-label` plan-state write removes only the `plan:*` labels the issue carries, so a phase label the repository lacks no longer fails the write or leaves two phase labels on one issue.

## Status

- **State:** Released
- **Type:** bug
- **Sprint:** follow-ups-2-28-3
- **Issue:** #2066
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2502 merged
- **Started:** 2026-10-24, Jan Wloka, `bug/plan-state-write-fails-when-a`
- **Delivered:** 2026-10-24
- **Released:** 2026-10-28, v2.29.0

## Changelog

- A plan-state write on a GitHub issue succeeds when the repository has no label for some of the five phases, and it leaves exactly one `plan:*` label on the issue.

<!-- Board impact: none. The board reads the issue's labels through no path this change touches; the change is in `plot-host.sh` and the tracker adapter. -->

## Motivation

On 2026-10-18 the approve of #2054 and #2055 reported `plan-state=failed`: `plot-host: failed to update https://github.com/plot-pm/plot/issues/2054: 'plan:released' not found`. The repository had `plan:draft`, `plan:approved` and `plan:delivered`, and no `plan:design` or `plan:released`, while the `Workflow phases` key names all five.

`plot-host.sh` `issue-label` (line 5356) runs one `gh issue edit` with `--add-label` and `--remove-label`. `planStateLabelsToRemove` passes the other four phase labels as one comma-separated list, and `gh` fails the whole call when any one of them does not exist in the repository. On #2054 the add still landed, so the issue carried `plan:draft` and `plan:approved` together. The write then stopped at its first step, so the comment and the close never ran.

The same failure applies to the add: `--add-label` with a label the repository lacks also fails in `gh`. Today the add happened to name a label that existed.

## Design

### Approach

Two behaviours the issue asks for:

1. A phase label missing from the repository is not a reason to fail the write.
2. A partial write does not leave two phase labels on one issue.

Candidate approach, to confirm at review: `issue-label` reads the issue's current labels (`gh issue view <n> --json labels`), removes only the listed labels the issue carries, and adds the new label. Where the repository lacks the label to add, `issue-label` creates it first (`gh label create`) and then adds it. Removal of a label the issue does not carry is then a no-op, and the add and the remove land in one `gh issue edit` call, so a failure leaves the issue unchanged rather than half-written.

The change stays inside `plot-host.sh`, the one place that talks to the host CLI, so `planStateLabelsToRemove` and `githubPlanStateWrite` keep their contract. Tests: `packages/domain/test/tracker-plan-state.test.ts` and `test/reconcile/release-tells-the-tracker.test.mjs` cover the write today; each gets a case with a repository that lacks `plan:design` and `plan:released`.

### Open Questions

- [x] Create a missing label on add, or fail with a named refusal? Creating it. The created label takes one fixed colour, `ededed`, and a description of the form `Plot plan phase: <phase>` — neither is a config key.
- [x] Read-then-edit costs one extra host call per write. Does the write read the labels from the issue-index file (`.plot/state/index/issues.json`) instead, and does that file carry labels? No — confirmed via `grep -n labels packages/fleet/src/shared/issue-refresh.ts` (no match): the index carries no label field, and *A Decision Reads The Index* rules out a stale reading deciding a write in any case. The write reads the issue's labels live, through `gh issue view`.
- [x] Does an existing issue with two phase labels (as #2054 had) get repaired by the next write? Yes — confirmed by test: an issue seeded with `plan:draft` and `plan:approved` ends a `released` write carrying exactly `plan:released`.

## Slices

### Label write

- `bug/plan-state-write-fails-when-a` — `issue-label` removes only carried labels, creates a missing label before the add, and applies both in one edit; tests cover a repository missing `plan:design` and `plan:released` → #2553

## Notes

- Source: issue #2066 (https://github.com/plot-pm/plot/issues/2066). The plan names the issue in `Issue:`; nothing was written to the tracker.
- Workaround applied by the reporter on 2026-10-18: created `plan:design` and `plan:released` by hand and removed `plan:draft` from #2054.
- Definition of Done: docs/definition-of-done.md
