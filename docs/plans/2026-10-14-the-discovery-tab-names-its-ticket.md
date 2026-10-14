# The Discovery tab names its ticket and story groups and toggles between them

> The Discovery tab puts a counted heading over the ticket lanes and over the story lanes, and a segmented control shows Tickets, Stories or Both, kept in the URL.

## Status

- **State:** Approved
- **Type:** feature
- **Issue:** #1693
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-14, Jan Wloka, plan-PR #1694 merged

## Changelog

- The Discovery tab heads the ticket lanes *Tickets (n)* and the story lanes *Stories (n)*. Each count follows the tag cloud's selection.
- A segmented control above the lanes offers *Tickets*, *Stories* and *Both*. *Both* is the default.
- The choice is kept in the `?show=` URL parameter and survives a reload. *Both* writes no parameter.

Board impact: changes `packages/board` only. No change to the plan format, the template, the helper scripts, `plot-host.sh`, the board payload or the issue index.

## Motivation

`StoriesTab.tsx` renders the ticket lane group above the story lanes with no heading over either group. A reader cannot tell which lanes hold tickets and which hold stories, and cannot hide one group to work on the other. `?archived=1` is the one URL parameter the tab writes today.

## Design

### Approach

One pure helper decides what the tab shows. `.tsx` renders its result and decides nothing (*Every rendered state is a domain property*).

- **Input.** The `show` value (`tickets`, `stories` or `both`), the ticket lane groups and the story lane groups, each after the tag cloud's selection and the *Show archived* scope.
- **Output.** Whether each group shows, each heading text, and each count.
- **URL.** The toggle writes `?show=tickets` or `?show=stories` and removes the parameter for *Both*, in the way *Show archived* writes `?archived=1`. A page load reads it. An unknown value reads as *Both*.
- **Composition.** The tag cloud (#1690) and *Show archived* apply to whichever groups show.
- **Constraints.** No change to the payload, the issue index or the host reads, and no restart.

### Decisions

- **A heading counts every row of its group,** the Done rows behind *Show all done* included, after the tag cloud's selection and the *Show archived* scope. Decided by the person on 2026-10-14.
- **The tag cloud counts only the groups on screen.** The helper's result says which groups show, and the cloud's counts follow it (#1690's plan records the same decision).
- **The parameter survives a reload,** including the re-fetch *Show archived* makes; `?show=` and `?archived=1` are written and read independently.
- **Order.** This slice changes `StoriesTab.tsx` after the tag cloud's lanes slice, so it waits on `feature/the-lanes-filter-by-topic`, which itself waits on the ticket card slice.

## Slices

### Groups

- `feature/the-discovery-groups-have-a-toggle` — a pure helper returns which groups show, their headings and their counts, `StoriesTab.tsx` renders the headings and the segmented control and keeps `?show=` in the URL, and a browser test switches through all three options and reloads with the parameter set <!-- builds: discoveryGroups, a pure helper for group visibility, headings and counts --> <!-- waits: feature/the-lanes-filter-by-topic -->

## Notes

- Created from tracker issue #1693. Nothing was written to the tracker.
- The slice edits `StoriesTab.tsx`, as #1689 (ticket card) and #1690 (tag cloud) do, so it waits on both. The `waits:` names are the branches those plans declare; verify them when the plan is refined.
