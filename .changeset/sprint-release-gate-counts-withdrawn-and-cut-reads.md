---
"@plot-pm/board": patch
---

The Jira Release drift gate no longer reports a withdrawn Must-have as missing from the Release: `sprintReleaseDrift` now keeps each item's collector-reported state and excludes `withdrawn` Must-haves from `missingFromRelease` and `notCompared`, while `missingFromSprint` still reads every tier regardless of state. The gate also stops reporting false drift against a Release read that was cut at its page limit — `sprintVerdict` now checks `VersionRead.complete` and returns `checked: false` with a reason naming the cut, rather than comparing against a truncated issue list. `resolveItemKey` returns the matched Jira key out of a `ticket:` frontmatter value instead of the whole trimmed string, so a URL or quoted value no longer becomes the key. Also: removes the unreachable `{ checked: false }` arm of `SprintVerdict`, removes the unused `limit` field `inputFrom` read from the collector's report, corrects the `issueLineKeys` docstring and the `release-gate.ts` comment on how an unplanned item is named, and routes `sprint-release-gate.ts`'s config read through the `Scripts` port's `config` op instead of a direct `plot-config.sh` call — lowering `check-script-names.sh`'s ratchet from 19 to 18.

<!--
plan: docs/plans/2026-10-24-sprint-release-gate-and-sprint-readers.md
bumps:
  skills: {}
-->
