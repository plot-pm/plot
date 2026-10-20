# Tracker: plot reads as an unknown tracker in issue-list

> `Tracker: plot` is the value `/plot-sprint` requires, and `issue-list` refuses it as an unknown external tracker.

## Status

- **State:** Approved
- **Type:** bug
- **Issue:** #2077
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-20, Jan Wloka, plan-PR #2151 merged

## Changelog

- A repository that declares `Tracker: plot` lists its open issues from its git host, as a repository with no `Tracker` declaration does.

Board impact: **to assess.** The board reads open issues through `issueSource` (`packages/board/src/server/entry/issue-source.ts`, `fleet.ts`), so a repository declaring `Tracker: plot` changes from an empty inbox with a refusal to a populated one.

## Motivation

Field test on 2026-10-19 against ewz-kus-portal. That repository declares `Tracker: plot` in its `## Plot Config`, because `/plot-sprint` proceeds only under `Tracker: plot` or no declaration (`skills/plot-sprint/SKILL.md`, tracker gate).

`plot-host.sh issue-list` exits 4 there with: ``no connector lists issues from the declared tracker `plot` ``. `issueSource` (`packages/domain/src/rules/issue-source.ts:57`) lowercases the first word of the declaration and looks it up in the connector list. `plot` has no entry, so the rule answers `nobody`.

The value therefore has two meanings: the sprint gate reads `plot` as "no external tracker", and `issueSource` reads it as an external tracker no connector serves.

## Design

### Approach

Pick one meaning for `Tracker: plot` and make both readers follow it. The issue names two options:

1. **`plot` means no external tracker.** `issueSource` treats `plot` like an empty declaration and answers `git-host`. The sprint gate already reads it that way, so only the rule changes.
2. **`/plot-sprint` documents another value**, and `issue-list` names that value in its refusal. This changes a config value that repositories already declare.

Option 1 matches the existing sprint gate and the `Setup` block's `Tracker: plot | jira <url> | github-issues | linear <url>` list, where `plot` is the default. This plan leans to option 1 and leaves the decision to the reader.

Checks for the slice:

- Every other reader of the `Tracker` value (`trackerFor`, `tracker-resolve.ts`, `plot-config.sh get "Tracker" "plot"` callers) treats `plot` the same way.
- A corpus or unit test names `plot` beside the empty declaration, so the two cannot drift again.
- The existing test that asserts the refusal for an unknown scheme keeps a scheme that is not `plot`.

### Open Questions

- [ ] Option 1 or option 2 above?
- [ ] Does any caller of `trackerFor` or the tracker write path (`trackerNone`) also reject `plot`? Measure before the slice is written.

## Slices

### Tracker plot reads as the git host

- `bug/plot-reads-as-an-unknown-tracker` — `issueSource` answers `git-host` for `Tracker: plot`, with a test covering `plot`, an empty declaration, and an unknown scheme.

## Notes

- Source: https://github.com/plot-pm/plot/issues/2077
