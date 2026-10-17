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

- A GitHub issue with a plan shows the plan's phase as a `plan:draft`, `plan:approved`, `plan:delivered` or `plan:released` label, and one comment links the plan. A release closes the issue with a comment that names the release version. A Jira issue gets a status at approve, deliver and release through `Tracker approved status`, `Tracker delivered status` and `Tracker released status`, and gets no draft status, no label and no comment.
- The board inbox counts an issue as planned when an open plan's `Issue:` field names it, or when the plan in a Draft plan PR names it. The board reads this from git and never reads a `plan:*` label.

<!-- Board impact: the inbox derives "planned" from git, including plans on Draft plan PR branches, and filters *Waiting on you* by the same set. No change to the plan format, the template or `issues.json`. -->

## Motivation

A GitHub issue with a plan reads as `open` until a person closes it. The plan's `Issue:` field links plan to issue in one direction only. `plot-issue-status.sh` writes a status at delivery and release, and on a GitHub tracker each write answers `no-target`: that connector writes a pull request's Projects status and has no issue status. Plot closes no issue today: `skills/plot-release/SKILL.md:455` states that the release "closes no issue, creates none and comments on none", and `plot-reconcile-scan.sh:3114` tells a person to close a finished plan's issue by hand. Measured 2026-10-17: 16 open issues had a plan in review, approved or delivered, and none showed it. The labels `plan:draft`, `plan:approved` and `plan:delivered` exist on plot-pm/plot since 2026-10-17 and were applied to those 16 issues by hand.

## Design

### Approach

Each lifecycle command writes the issue's plan state through the tracker connector. No command calls `gh` directly (`trackerGitHost` on GitHub).

| Command | GitHub tracker | Jira tracker |
|---|---|---|
| `plot-idea` (plan PR opened) | label `plan:draft`; one comment with the plan PR link | none (no `Tracker draft status` key) |
| `plot-approve` | label `plan:approved`; the comment changes its link to the plan file on the default branch | `Tracker approved status` (new key) |
| `plot-deliver` | label `plan:delivered` | `Tracker delivered status` |
| `plot-release` | label `plan:released`; close the issue with a comment that names the release version | `Tracker released status` |

Domain: extend `issueStatusWrites` (`packages/domain/src/rules/issue-status.ts`) with the draft and approved phases. The `Tracker` port grows one method, `planStateWrite`, beside `statusWrite` and `issueOpen`. It takes the issue, the phase, the plan link and, for `released`, the release version. `trackerGitHost` implements it over three new `plot-host.sh` operations (`issue-label`, `issue-comment`, `issue-close`), because `plot-host.sh` has no issue write beside `issue-open` and `issue-status` today. `trackerNone` answers `unaskable`. A Jira tracker keeps `statusWrite` and answers `no-target` to `planStateWrite`. A label write replaces the previous `plan:*` label, so an issue carries one. `StatusWrite` stays unchanged, and the `Issue` entity (`packages/domain/src/entities/issue.ts`) and `IssueIndexRow` keep no labels. `plot-issue-status.sh` stays the shell entry and gains the `Tracker approved status` read.

Release: Plot closes no issue today, and this plan adds that as a new write. `plot-release` calls `planStateWrite` with `released` for each issue the plan's `Issue:` line names. On GitHub the write sets `plan:released`, posts one comment that names the release version, and closes the issue. On Jira the existing `Tracker released status` write stays the only write. The `plot-release/SKILL.md:455` sentence and the hand-close advice at `plot-reconcile-scan.sh:3114` change to match.

Rules: three documented rules forbid this write as they read today. `packages/domain/src/ports/tracker.ts:51-53` calls a label on a status write "the mirror this port exists to refuse", and `:149-152` says Plot writes "no comment, no label on an existing issue". `packages/domain/src/entities/issue.ts:21-29` leaves labels out of the entity, because a field Plot writes and reads back is a write-back loop. `skills/plot/MANIFESTO.md:17` makes a tracker a read-only reflection, never the source of truth. A one-way write keeps all three intact in substance: Plot writes the label and the comment, and no Plot code reads them back. Git stays the source of truth for the plan's phase, and the board derives "planned" from git. The label is a reflection a person reads in the tracker, as the status write already is. The connector slice amends the doc comments at `tracker.ts:51-53,149-152` and `issue.ts:21-29` to name `planStateWrite` as the third write and to state that no rule reads a `plan:*` label.

Board: the inbox derives "planned" from git and never from a label. Today `referencedIssues` (`packages/board/src/server/fleet.ts:1479`) reads the `Issue:` field of each plan in the plan directory, and `inboxOf` (`fleet.ts:1723`) removes those issues from `issues`. Two gaps remain. A Draft plan PR's plan lives on its `idea/` branch and is not in the plan directory, so its issue still shows as unplanned. `waitingOf` receives the open rows unfiltered by `referenced` (`fleet.ts:1939`, `fleet.ts:2054`), although `waitingTickets` (`packages/domain/src/rules/waiting-tickets.ts`) expects its caller to filter. The inbox slice adds the issues named by the plan of each open Draft plan PR, read from the PR's head branch through git, to the `referenced` set, and passes *Waiting on you* the same filtered rows.

### Open Questions

- [x] Does the issue index (`issues.json`) carry labels today? No: `IssueIndexRow` and the `Issue` entity carry no labels, and the board needs none, because it derives "planned" from git. `issues.json` keeps its version.
- [ ] A write that fails is reported and never raised, as for the delivered and released writes. Does `plot-idea` follow the same rule when the plan PR is already open?
- [ ] Idempotence: a re-run of `plot-approve` must not post a second comment. The comment needs a marker the connector can find.

## Slices

### Connector and inbox

- `feature/issue-plan-state-write` — issue status rule gains draft and approved; the tracker port gains `planStateWrite` (label, one comment, close at release); `trackerGitHost` implements it over new `plot-host.sh` issue operations; the port and entity doc comments name the one-way write <!-- builds: the issue plan-state label write on the tracker port -->
- `feature/issue-plan-state-inbox` — `referencedIssues` in `packages/board/src/server/fleet.ts` adds the issues a Draft plan PR's plan names, and `waitingOf` receives the rows filtered by `referenced`; no label is read

### Lifecycle commands

- `feature/issue-plan-state-commands` — `plot-idea`, `plot-approve`, `plot-deliver` and `plot-release` call the write, and the release closes the issue with a comment naming the version; `Tracker approved status` is documented in the config reference; `plot-release/SKILL.md` and `plot-reconcile-scan.sh` stop saying a person closes the issue by hand <!-- waits: feature/issue-plan-state-write -->

## Notes

- Source: https://github.com/plot-pm/plot/issues/1979. The plan writes nothing to the tracker until it is approved and implemented.
- 2026-10-17: amended after review #1986 by Jan Wloka's decision: inbox reads git, labels are a one-way reflection, release closes the issue.
