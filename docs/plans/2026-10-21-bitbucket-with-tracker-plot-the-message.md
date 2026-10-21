# Bitbucket with Tracker: plot: the message names the working configuration

> Under `Tracker: plot` on a Bitbucket repository, the exit-4 refusal of `issue-list` names `Tracker: jira <base URL>` with `Sprint owner: plot`, and adoption proposes that pair.

## Status

- **State:** Delivered
- **Type:** bug
- **Sprint:** bitbucket-jira-and-jenkins-work-with-the-board
- **Issue:** #2216
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2221 merged
- **Started:** 2026-10-21, Jan Wloka, `bug/bitbucket-with-tracker-plot-the-message`
- **Started:** 2026-10-21, Jan Wloka, `bug/bitbucket-with-tracker-plot-adoption`
- **Delivered:** 2026-10-21

## Changelog

- A Bitbucket repository that declares `Tracker: plot` and cannot list issues gets a refusal that names the working configuration, `Tracker: jira <base URL>` together with `Sprint owner: plot`. `/plot-board-setup` and `/plot-init` propose that pair when they find a Bitbucket remote and a Jira project key in branch names.

Board impact: **to assess.** The board shows the refusal sentence in place of the inbox, so the sentence it shows changes. No plan-format change.

## Motivation

Issue #2216, measured read-only on 2026-10-21 against ewz-kus-portal at main `01a6cf2ad`: under `Tracker: plot`, `plot-host.sh issue-list` exits 4 with `bb 1.0.0 lists no issue command … cannot be read through it`. With `PLOT_TRACKER="jira https://quatico.atlassian.net"`, the same repository lists its EWZKUS tickets with status, assignees and type.

Since #2195, `bbIssueCommandMissing` (`packages/domain/src/rules/issue-source.ts`) drops the advice to declare `Tracker` when the repository already declared one, because that advice misled a repository that had. The sentence then names no remedy at all. The remedy exists since #2169: `Sprint owner: plot` keeps `/plot-sprint` running while `Tracker: jira <url>` names where the issues live. Nothing tells the operator.

Release 2.28.0 waits on this.

## Design

### Approach

**Message.** `bbIssueCommandMissing` returns a sentence ending in the pair `Tracker: jira <base URL>` and `Sprint owner: plot` when `declared` is `plot`. For an empty `declared` it keeps today's advice to declare the `Tracker` key. The sentence is one domain function; `plot-host.sh` keeps asking it through `--bb-issue-missing`, and the shell fallback string stays in step with the empty-`declared` arm.

**Adoption.** `/plot-board-setup` step 4 and `/plot-init` already propose `Tracker: jira` from a repeated ticket prefix. On a Bitbucket remote with such a prefix they also propose `Sprint owner: plot` when the repository runs sprints, and they state that the pair is the configuration a `Tracker: plot` repository moves to.

**Not changed.** `issueSource` still reads only `Tracker`; `Sprint owner` still answers only who owns sprints (#2169).

### Open Questions

- [ ] Does the message name the base URL it has, or the placeholder `<base URL>`? The `Tracker` value is `plot` in the failing case, so the URL is known only from a Jira project key in branch names or from another config key.
- [ ] Does `Sprint owner: plot` belong in the message when the repository runs no sprints?

## Slices

### Message

- `bug/bitbucket-with-tracker-plot-the-message` — `bbIssueCommandMissing` names the working configuration under `Tracker: plot`; the shell fallback and the issue-source entry test follow → #2232

### Adoption

- `bug/bitbucket-with-tracker-plot-adoption` — `/plot-board-setup` and `/plot-init` propose `Tracker: jira <base URL>` with `Sprint owner: plot` on a Bitbucket remote with a Jira key in branch names <!-- waits: bug/bitbucket-with-tracker-plot-the-message --> → #2245

## Notes

- Follows #2169 (`plot-on-a-bitbucket-repository-lists`) and #2195.
- Writes nothing to the tracker; the `Issue:` field is the only link.
