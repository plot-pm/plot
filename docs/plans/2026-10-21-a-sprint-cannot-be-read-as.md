# A sprint can be read as a Jira Release

> The Jira tracker connector reads a version and the issues whose fixVersion names it, so `/plot-sprint` can read a sprint from it when `Sprint owner` says so.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:**
- **Issue:** #2212
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2217 merged

## Changelog

- `/plot-sprint` reads a sprint as a Jira Release (fixVersion) on a Jira-tracked project whose `Sprint owner` names the tracker, and checks the sprint's Must-haves against that Release's issues.

Board impact: to be assessed in the Design pass. The plan adds a read path to the tracker port and does not change the plan format.

## Motivation

The decision on #2169 is that under a Jira tracker a Plot sprint is a Jira Release. #2204 delivered only the `Sprint owner` config key: the `plot-config.sh` documentation, a prose gate in the `plot-sprint` `SKILL.md`, and a domain `sprintOwner()` with 0 callers. No connector reads a Jira version or its issues: `packages/domain/src/adapters/tracker/tracker-jira.ts` has no fixVersion or version endpoint.

Measured 2026-10-21 on ewz-kus-portal at main `01a6cf2ad`, read-only: no read path exists for the release `kus-portal-102` or its issues.

Effect: `/plot-sprint` and `/plot-release` cannot check a sprint's Must-haves against the Jira Release on a Jira-tracked project. The sprint-owner gate is prose, not a gate.

## Design

### Approach

1. Add a read to the `Tracker` port (`packages/domain/src/ports/tracker.ts`) that returns a version (name, released flag, release date) and the issues whose fixVersion names it. The port stays a domain interface; the adapters that cannot answer return `unaskable`, as `trackerNone` does for every operation.
2. Implement it in `tracker-jira.ts` over the Jira REST version and JQL (`fixVersion = "<name>"`) endpoints. The Jira connector keeps its own account and rate-limit accounting.
3. Give `sprintOwner()` its first caller: `/plot-sprint` asks the domain which source owns the sprint and reads the Release when the answer is the tracker. The sprint-owner check becomes a controller refusal instead of prose.
4. `/plot-release` reads the same value to compare the Release's issues with the sprint's Must-haves.

Layering follows CLAUDE.md: controller → domain → port ← adapter. A shell script reaches the read through a bundle, not through a second Jira caller.

### Open Questions

- [ ] Which `Sprint owner` value selects the tracker (`tracker`, `jira`)? The config documentation names only `plot` today.
- [ ] How does a sprint name map to a version name (`kus-portal-102`): an explicit `Sprint:` mapping, or equal names?
- [ ] Which Jira statuses count as done for a Must-have?
- [ ] Does the read write to the issue index, or stay a direct call?

## Slices

### Read path

- `feature/jira-version-read` — Tracker port read for a version and its fixVersion issues, with the Jira implementation and fixture tests <!-- builds: versionRead, a Tracker port read for a Jira version and its issues -->

### Sprint source

- `feature/sprint-reads-jira-release` — `/plot-sprint` and `/plot-release` read the sprint from the Jira Release when `Sprint owner` names the tracker; `sprintOwner()` gains its caller

## Notes

Created from issue #2212 by `/plot-idea`. Stopped at Draft; approval is a separate decision.
