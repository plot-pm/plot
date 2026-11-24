# The checklist badge reads the newest release

> The board's release-checklist badge picks the checklist of the newest release by version order, with `vnext-checklist.md` first, so the trial use of the checklist in the sprint's release shows the right count.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:**
- **Issue:** #1839
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-24, jwloka, plan-PR #3699 merged

## Changelog

- The release-checklist badge on the board counts the checklist of the newest release. Before, it sorted file names as text and showed the 2.9.0 checklist while a 2.19.0 checklist existed.

<!-- Board impact: the badge's file choice moves into a domain rule; the badge's shape and the docs/releases layout do not change. No plan format, template or helper script changes. -->

## Motivation

#1839 tracks six closed members of the release gate and the release checklist: #1501, #1597, #1605, #1609, #1669 and #1682. A research dossier of 2026-11-20 states that the release checklist is used rarely and recommends "Use each for one sprint or remove it" (`gap-unused-switches`). The estate confirms the first half: `docs/releases/` holds 3 checklists (`v2.1.0`, `v2.9.0`, `v2.19.0`) across releases 2.1.0 to 2.36.0, and the last one was written on 2026-09-20 for `v2.19.0-rc.1`. This repository sets `Auto-verify: false`, so no verify run writes `vnext-checklist.md`.

**One member is live on main today.** #1609 reports that `readChecklist` (`packages/board/src/server/board.ts:782`) sorts file names as text (`board.ts:785`, `.filter(...).sort()`) and takes the last one. With `v2.9.0-checklist.md` and `v2.19.0-checklist.md` both present, as they are on main, the badge (`packages/board/src/app/components/Board.tsx:203`) counts the 2.9.0 checklist. `vnext-checklist.md` sorts last only because `n` sorts after `2` as text, not because a rule says so.

**Why it matters for the sprint goal.** The sprint ends 2026-12-04 with a release. To use the checklist for one sprint, as the dossier asks, the operator writes a `vnext-checklist.md` for that release, and the badge is where the operator and a second operator read its progress. A badge that counts another release's file makes the trial unreadable, and a trial nobody can read gives no basis for the keep-or-remove decision.

## Design

### Approach

- **The file choice is a domain property.** A new rule `newestChecklist(names)` in `packages/domain/src/rules/release-checklist.ts` takes the file names in the release directory and returns the one the badge counts, or `null`. It keeps names that match `-checklist.md`, ranks `vnext-checklist.md` above every versioned name, orders `v<N.N.N>-checklist.md` by `compareVersions` (`packages/domain/src/entities/version.ts:47`), and ignores any other name. It is an arrow function with no I/O.
- **The board reads and the domain decides.** `readChecklist` in `board.ts` keeps its `readdirSync` and `readFileSync` and calls `newestChecklist` instead of `.sort().at(-1)`. `countChecklist` stays as it is.
- **No new version comparison.** `compareVersions` already orders `v2.9.0` before `v2.19.0` and is the comparison the release tag rule uses.

### Open Questions

- [ ] `[question-rc-file-names]` `/plot-release` renames `vnext-checklist.md` to `v<version>-checklist.md` at a final release. A name such as `v2.19.0-rc.1-checklist.md` does not match `vN.N.N` and `compareVersions` ranks it as `0.0.0`. Recommendation: the rule ignores a name it cannot order and a test holds that, because no such file exists on main.
- [ ] `[question-trial-owner]` The dossier's one-sprint trial is an operator action, not a slice: write `docs/releases/vnext-checklist.md` for the release of 2026-12-04 and record at the sprint review whether it was used. Recommendation: name it in the sprint file as a Should Have owned by the operator, and decide keep or remove at that review.

### Out of Scope

- #1597: the release gate (`skills/plot/scripts/plot-release-gate.sh`) reads the local checkout, not `origin/<default>`. The script is unchanged since #848.
- #1605: a release record leaves the template's `Released:` placeholder beside the new line.
- #1501 M1, M2, L1 to L3: the deferred-PR filter in `plot-plan-meta.sh` and `rules/release-tag.ts`.
- #1669 M1 to M5, L1 to L4, and #1682 M1 to M3, L1 to L3: the checklist writer and `skills/plot-release/SKILL.md` follow-ups. They matter only once a verify run writes the checklist, and the trial decides whether that happens.

## Slices

### Badge

- `bug/the-checklist-badge-orders-by-version` — `newestChecklist` chooses the checklist file by version order with `vnext-checklist.md` first, and `readChecklist` in `board.ts` calls it <!-- builds: newestChecklist, the release-checklist file choice rule --> <!-- tests: newestChecklist — v2.9.0 and v2.19.0 give v2.19.0; vnext beside both gives vnext; a name that is not vN.N.N is ignored; no checklist gives null; a board test over a directory with v2.9.0 and v2.19.0 counts the 2.19.0 file -->

## Notes

Created on 2026-11-23 from issue #1839, for the sprint plot-describes-itself.

Type `bug`: the badge shows a wrong count on main today, and the fix changes no feature.

#1839 stays open after this plan; the plan answers #1609 only.
