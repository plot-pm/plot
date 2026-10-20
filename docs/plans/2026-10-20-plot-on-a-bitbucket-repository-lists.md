# Tracker: plot on a Bitbucket repository lists no tickets

> A Bitbucket repository with Jira tickets declares `Tracker: plot` so `/plot-sprint` runs, and `issue-list` then refuses because `bb` has no issue command.

## Status

- **State:** Approved
- **Type:** feature
- **Issue:** #2169
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-20, Jan Wloka, plan-PR #2171 merged
- **Started:** 2026-10-20, Jan Wloka, `bug/plot-on-a-bitbucket-repository-lists-no-tickets`

## Changelog

- A Bitbucket repository that runs sprints and keeps its tickets in Jira shows those tickets on the board from its `## Plot Config` alone.

Board impact: **to assess.** The board reads open issues through `issueSource` (`packages/domain/src/rules/issue-source.ts`) and shows its *Waiting on you* rows from the issue index, so the change decides whether a Jira-backed repository gets rows or an absence sentence.

## Motivation

Field test on 2026-10-20 of main `45cd9fd71` (after #2161 for #2077) against ewz-kus-portal: Bitbucket host, Jira tickets (`EWZKUS-###`), `Tracker: plot` in `AGENTS.md`.

`plot-host.sh issue-list` exits 4 with `bb 1.0.0 lists no issue command — Quatico bb has none, unlike craftamap/bb — so this repository's issues cannot be read through it; declare the issue tracker with the `Tracker` config key` (`skills/plot/scripts/plot-host.sh:2277`).

#2161 maps `Tracker: plot` to `{ask: 'git-host'}` (`issueSource`, `rules/issue-source.ts`). On GitHub that lists GitHub issues. On Bitbucket the git-host arm refuses, because Quatico `bb` has no issue command. The board shows no tickets.

The repository declares `Tracker: plot` only because `/plot-sprint` declines any external tracker (`skills/plot-sprint/SKILL.md`, tracker gate; ewz-kus-portal `AGENTS.md:86`). Its tickets live in Jira. With `PLOT_TRACKER="jira https://quatico.atlassian.net"` set in the environment, `issue-list` returns EWZKUS-3883..3877.

Two defects follow:

- One config key carries two questions: *who owns sprints* and *where do issues live*. A repository that answers "plot" to the first and "Jira" to the second has no way to say so in config.
- The refusal text advises declaring the `Tracker` key, which the repository already declares.

## Design

### Approach

The issue names two options for the config shape. The plan leaves the choice to the reader.

1. **`/plot-sprint` accepts an external tracker.** The repository declares `Tracker: jira <url>`, `issueSource` answers `tracker`, and the sprint gate stops reading the `Tracker` value as the sprint owner. This removes the second meaning of `plot` but reverses the gate's rule that a shadow sprint board drifts.
2. **Sprint ownership and issue source become separate keys.** `Tracker` keeps meaning the issue source; a new key (name open) says who owns sprints. `Tracker: plot` keeps meaning "no external tracker" and nothing changes for repositories that declare it today.

The issue also asks for two behaviours that hold under either option:

- Under `Tracker: plot` on a host with no issue command, `issue-list` answers "nothing to list" and not a refusal.
- The exit-4 text names the `Tracker` key only where the repository has not declared it.

Checks before the slices are written:

- Every reader of the `Tracker` value (`trackerFor`, `tracker-resolve.ts`, the sprint gate, `plot-config.sh get "Tracker" "plot"` callers) is listed, with what each does for `plot`, `jira <url>` and an absent key.
- The `bb_assert_issue_version` refusal (`plot-host.sh:2277`) and the `issue-list` consumers it reaches read the same distinction: a host that cannot list versus a tracker nobody declared.
- A test names `Tracker: plot` on Bitbucket beside `Tracker: plot` on GitHub, so the two cannot drift.

### Open Questions

- [ ] Option 1 or option 2 above?
- [ ] If option 2: what is the new key's name, and what does a repository with only `Tracker: jira <url>` get for sprints?
- [ ] Is "nothing to list" a distinct answer from `nobody`, and does the board show it as an empty inbox or as an absence sentence?

## Slices

### Issue list under Tracker plot

- `bug/plot-on-a-bitbucket-repository-lists-no-tickets` — `issue-list` on a host with no issue command answers "nothing to list" under `Tracker: plot`, and the exit-4 text stops advising a key that is already declared. → #2195

### Sprint and issue source

- `feature/sprint-ownership-and-issue-source` — the config shape the reader picks in Open Questions, so a Bitbucket and Jira repository runs sprints and lists its Jira tickets from config alone.

## Notes

- Source: https://github.com/plot-pm/plot/issues/2169
- Related: #2077 (delivered as `plot-reads-as-an-unknown-tracker`), whose option 1 produced the git-host mapping this plan revisits.
