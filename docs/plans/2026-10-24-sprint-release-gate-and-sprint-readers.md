# Sprint release gate and sprint readers misread sprint files

> Nine MEDIUM and eleven LOW follow-up findings from plot-review show the sprint/Release gate, the sprint readers and their tests reading sprint and plan files wrongly; this plan fixes them in four slices.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** follow-ups-2-28-3
- **Issue:** #2482
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2513 merged
- **Started:** 2026-10-24, jwloka, `bug/sprint-release-gate-ignores-withdrawn-and-partial-reads`
- **Started:** 2026-10-24, jwloka, `bug/sprint-readers-misread-goal-and-slug`
- **Started:** 2026-10-24, jwloka, `bug/story-lint-reduces-link-form-story`

## Changelog

- The Jira Release drift gate ignores withdrawn Must-haves and reports an incomplete Release read as not checked.
- `resolveItemKey` returns only the matched Jira key, not the whole `ticket:` value.
- `sprintGoal` reads the typed `>` goal before any bold paragraph label.
- `plot-review-status.sh` prints its error JSON for an unknown sprint slug and no longer reads the `[x]` checkbox as a slug.
- `plot-story-lint.sh` reduces a Markdown link in `Story:` like `plot-plan-meta.sh`, so check S5 covers link-form plans.
- The `/plot-sprint` verdict table reports a partial comparison when `notCompared` is not empty, and the skill runs the owner check through its launcher.
- The sprint-gate eval covers `Sprint owner: plot` with `Tracker: jira`, and `Sprint owner: jira`.

<!-- Board impact: the gate and `sprintGoal` changes alter what the board shows for a sprint (drift verdict, goal line). The board artifact is rebuilt by main after merge; slices must not commit it. -->

## Motivation

Issue #2482 collects follow-up findings from plot-review on ten merged PRs (#2049, #2205, #2246, #2267, #2298, #2307, #2314, #2329, #2433, #2448), checked against `origin/main` at `84b1638e4` on 2026-10-24. Nine are MEDIUM. Each is a reader that takes the wrong text from a sprint or plan file, or a gate that answers `checked: true` on input it did not fully read:

- `sprint-release-gate.ts:157` drops each item's state, so a withdrawn Must-have counts as missing from the Release.
- `sprint-release-gate.ts:253` ignores `VersionRead.complete`, so a Release read cut at 200 issues reports `checked: true` with false drift.
- `rules/sprint-release.ts:121` tests the unanchored `JIRA_KEY` on the `ticket:` value but returns the whole string, so a URL or quoted value becomes the key.
- `entities/sprint.ts:203` (`boldGoal`) takes the first bold label of any paragraph under `## Sprint Goal`, so `**Motivation:**` wins over the typed `>` goal.
- `plot-review-status.sh:14` exits 1 with empty stdout on an unknown slug under `set -e` and `pipefail`; `:37` reads the `[x]` checkbox as slug `x`.
- `plot-story-lint.sh:102` reads `Story:` with its own awk and skips link-form values, so check S5 silently skips those plans.
- `skills/plot-sprint/SKILL.md:843` prints "in sync with Jira" when `notCompared` is not empty.
- The sprint-gate eval has no case for `Sprint owner: plot` with `Tracker: jira`, nor for `Sprint owner: jira`.

The LOW findings are wrong comments, wrong test titles, a dead `{ checked: false }` arm in `SprintVerdict`, a limit `inputFrom` reads and no collector writes, and a ratchet raised in `scripts/check-script-names.sh` where the config read belongs in an adapter.

## Design

### Approach

Four slices, grouped by the code each touches, so each PR stays reviewable and no two slices edit the same file. Every MEDIUM fix lands with a test that fails against the unfixed code.

- **Release gate** fixes `sprint-release-gate.ts` (keep item state and skip withdrawn Must-haves; read `VersionRead.complete` and return not checked when it is false; drop the unreachable arm and the unused limit; correct the `issueLineKeys` docstring) and `resolveItemKey` in `rules/sprint-release.ts` (return the matched key). It also corrects the `release-gate.ts:115` comment and decides the `check-script-names.sh:141` ratchet: move the config read to an adapter and lower the ratchet, or record why it stays.
- **Sprint readers** fixes `sprintGoal`/`boldGoal` so the typed `>` goal wins, corrects the `board.ts:1463` comment, and fixes `plot-review-status.sh` (guard the `ls | head` lookup; match the slug outside the `[x]` checkbox). It also corrects the title and comment in `review-status-slug-match.test.mjs` (lines 176 and 80).
- **Story lint** makes `plot-story-lint.sh` reduce `[text](target)` to `text` the way `plot-plan-meta.sh` does, preferably by asking the same reader rather than a second awk. It also updates the `story` field description in `plot-plan-meta.sh:108` and makes `story-filter-reduced-slug.test.ts` run the parser.
- **Sprint skill and eval** changes the `/plot-sprint` verdict table to print a partial-comparison verdict when `notCompared` is non-empty, runs the owner check through the `.sh` launcher, and adds the two missing cases to `promptfooconfig.sprint-gate.yaml` (including the "tracker gate" wording in its prompt). A `skills/plot-sprint/SKILL.md` change needs a changeset with a `bumps:` block.

### Open Questions

- [ ] Does the `check-script-names.sh` ratchet lower with the config-read move, or stay for a reason the slice records?
- [ ] Does `plot-story-lint.sh` call `plot-plan-meta.sh` for `Story:`, or keep awk with the link reduction added? The first removes the duplicate reader; the second changes less.
- [ ] Re-check each cited line against `main` at slice start; line numbers move.

## Slices

### Release gate

- `bug/sprint-release-gate-ignores-withdrawn-and-partial-reads` → #2576 — Keep item state in the Jira Release drift gate, report an incomplete Release read as not checked, and make `resolveItemKey` return only the key.

### Sprint readers

- `bug/sprint-readers-misread-goal-and-slug` → #2596 — `plot-review-status.sh` handles an unknown slug and the `[x]` checkbox. Does not change `sprintGoal`'s order: `sprint-goal.test.ts` pins bold-before-quote on purpose (PR #2043's re-review, 16 of 20 sprint files read motivation in the `>` block), so this line's original "reads the typed `>` goal first" was stale and was not implemented.

### Story lint

- `bug/story-lint-reduces-link-form-story` — `plot-story-lint.sh` reduces a Markdown link in `Story:` so check S5 covers link-form plans.

### Sprint skill

- `bug/plot-sprint-verdict-reports-partial-comparison` — The verdict table reports a partial comparison, the owner check runs through the launcher, and the sprint-gate eval covers the two missing owner cases.

## Notes

- Source: issue #2482, follow-up findings from plot-review.
- Plot Config declares `Plan PRs: required`, so the plan rides a draft PR from `idea/sprint-release-gate-and-sprint-readers`.
