# Tracker: a planned issue shows its plan state and link

> A tracker issue that has a plan carries a `plan:*` label and a comment linking the plan, written through the tracker connector.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:**
- **Issue:** #1979
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1985 merged

## Changelog

- A GitHub issue with a plan shows the plan's phase as a `plan:draft`, `plan:approved` or `plan:delivered` label, and a comment links the plan. A Jira issue gets the same phases through `Tracker approved status`, `Tracker delivered status` and `Tracker released status`.

<!-- Board impact: the board inbox reads the `plan:*` label and shows a labelled issue as planned. No change to the plan format or template. -->

## Motivation

A GitHub issue with a plan reads as `open` until a release closes it. The plan's `Issue:` field links plan to issue in one direction only. `plot-issue-status.sh` writes a status at delivery and release, and on a GitHub tracker each write answers `no-target`: that connector writes a pull request's Projects status and has no issue status. Measured 2026-10-17: 16 open issues had a plan in review, approved or delivered, and none showed it. The labels `plan:draft`, `plan:approved` and `plan:delivered` exist on plot-pm/plot since 2026-10-17 and were applied to those 16 issues by hand.

## Design

### Approach

Each lifecycle command writes the issue's plan state through the tracker connector. No command calls `gh` directly (`trackerGitHost` on GitHub).

| Command | GitHub tracker | Jira tracker |
|---|---|---|
| `plot-idea` (plan PR opened) | label `plan:draft`; one comment with the plan PR link | none (no `Tracker draft status` key) |
| `plot-approve` | label `plan:approved`; comment links the plan file on the default branch | `Tracker approved status` (new key) |
| `plot-deliver` | label `plan:delivered` | `Tracker delivered status` |
| `plot-release` | the release closes the issue, as today | `Tracker released status` |

Domain: extend `issueStatusWrites` (`packages/domain/src/rules/issue-status.ts`) with the draft and approved phases. The `Tracker` port gains an issue-label write; `trackerGitHost` implements it over the host connector's existing issue call, and `trackerNone` answers `unaskable`. A label write replaces the previous `plan:*` label so an issue carries one. `plot-issue-status.sh` stays the shell entry and gains the `Tracker approved status` read.

Board: the inbox rule (`waiting-tickets.ts`) reads the `plan:*` label from the issue index and shows a labelled issue as planned, not as a ticket to plan. The `Issue:` field keeps removing an issue from the inbox as today.

### Open Questions

- [ ] Does the issue index (`issues.json`) carry labels today? If not, adding them is a version bump of that file.
- [ ] A write that fails is reported and never raised, as for the delivered and released writes. Does `plot-idea` follow the same rule when the plan PR is already open?
- [ ] Idempotence: a re-run of `plot-approve` must not post a second comment. The comment needs a marker the connector can find.

## Slices

### Domain and connector

- `feature/issue-plan-state-write` — issue status rule gains draft and approved; the tracker port writes a label and a comment; `trackerGitHost` implements it <!-- builds: the issue plan-state label write on the tracker port -->

### Lifecycle commands

- `feature/issue-plan-state-commands` — `plot-idea`, `plot-approve` and `plot-deliver` call the write; `Tracker approved status` is documented in the config reference <!-- waits: feature/issue-plan-state-write -->

### Board inbox

- `feature/issue-plan-state-inbox` — the inbox reads the `plan:*` label and shows a planned issue as planned <!-- waits: feature/issue-plan-state-write -->

## Notes

- Source: https://github.com/plot-pm/plot/issues/1979. The plan writes nothing to the tracker until it is approved and implemented.
