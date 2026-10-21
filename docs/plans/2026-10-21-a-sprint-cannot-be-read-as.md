# A sprint can be read as a Jira Release

> The Jira tracker connector reads a version and the issues whose fixVersion names it, so `/plot-sprint` and `/plot-release` can compare a Plot sprint's Must-haves with the Jira Release its `Release:` field names.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** bitbucket-jira-and-jenkins-work-with-the-board
- **Issue:** #2212
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2217 merged
- **Started:** 2026-10-21, Jan Wloka, `feature/jira-version-read`
- **Started:** 2026-10-21, Jan Wloka, `feature/sprint-reads-jira-release`

## Changelog

- On a project with `Tracker: jira …` and `Sprint owner: plot`, `/plot-sprint` and `/plot-release` read the Jira Release (fixVersion) that the sprint file's `Release:` field names, and report each Must-have the Release lacks and each Release issue no sprint item names.

Board impact: to be assessed in the Design pass. The plan adds a read path to the tracker port and does not change the plan format.

## Motivation

The decision on #2169 is that under a Jira tracker a Plot sprint is a Jira Release. #2204 delivered only the `Sprint owner` config key: the `plot-config.sh` documentation, a prose gate in the `plot-sprint` `SKILL.md`, and a domain `sprintOwner()` with 0 callers. No connector reads a Jira version or its issues: `packages/domain/src/adapters/tracker/tracker-jira.ts` has no fixVersion or version endpoint.

Measured 2026-10-21 with plot main `01a6cf2ad`, run read-only against ewz-kus-portal: no read path exists for the release `kus-portal-102` or its issues.

Effect: `/plot-sprint` and `/plot-release` cannot check a sprint's Must-haves against the Jira Release on a Jira-tracked project. The sprint-owner gate is prose, not a gate.

## Design

### Approach

1. Add a read to the `Tracker` port (`packages/domain/src/ports/tracker.ts`) that returns a version (name, released flag, release date) and the issues whose fixVersion names it. The port stays a domain interface; the adapters that cannot answer return `unaskable`, as `trackerNone` does for every operation.
2. Implement it in `tracker-jira.ts` over the Jira REST version and JQL (`fixVersion = "<name>"`) endpoints. The Jira connector keeps its own account and rate-limit accounting.
3. Give `sprintOwner()` its first caller, and keep its rule unchanged (`packages/domain/src/rules/issue-source.ts:131-136`, pinned by `issue-source.test.ts:114` and `:123`). An external answer stays the decline it is today: Plot writes no sprint file, and that decline becomes a controller refusal instead of prose. No new `Sprint owner` value is added; any value other than `plot` still changes nothing.
4. The Release is read only when `sprintOwner()` answers `plot` and the tracker is Jira. The sprint file in `docs/sprints/` holds the commitment: its MoSCoW tiers are the Must-haves, and its existing `Release:` field (read by `plot-sprint-release.sh:14` and `:203`) is the Jira fixVersion name. The sprint name and the version name are not matched.
5. `/plot-sprint` status and `/plot-release` compare the two in both directions: a Must-have whose issue lacks the fixVersion, and a Release issue that no sprint item names. Each reports drift and changes nothing in Jira.

Layering follows CLAUDE.md: controller → domain → port ← adapter. A shell script reaches the read through a bundle, not through a second Jira caller.

### Open Questions

- [x] Which `Sprint owner` value selects the tracker? None: the domain rule already decides, and only `Sprint owner: plot` keeps the sprint in Plot. Decided 2026-10-21 by Jan Wloka: the commitment lives in the Plot sprint file, and the Jira Release is read beside it.
- [x] How does a sprint map to a version (`kus-portal-102`)? Through the sprint file's existing `Release:` field, which names the fixVersion. Decided 2026-10-21 by Jan Wloka.
- [ ] How does a sprint item name its Jira issue: the plan's `Issue:` field, or a key in the item text?
- [ ] Which Jira statuses count as done for a Must-have?
- [ ] Does the read write to the issue index, or stay a direct call?

## Slices

### Read path

- `feature/jira-version-read` — Tracker port read for a version and its fixVersion issues, with the Jira implementation and fixture tests <!-- builds: versionRead, a Tracker port read for a Jira version and its issues --> → #2236

### Sprint source

- `feature/sprint-reads-jira-release` — `/plot-sprint` status and `/plot-release` read the Jira Release that the sprint's `Release:` field names when `sprintOwner()` answers `plot` under a Jira tracker, and report drift both ways; `sprintOwner()` gains its caller and the external answer becomes a controller refusal → #2243

## Notes

Created from issue #2212 by `/plot-idea`. Stopped at Draft; approval is a separate decision.
