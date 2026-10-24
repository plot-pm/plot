## Implementation brief — sprint-release-gate-and-sprint-readers (wave: Sprint readers)

- **Plan (canonical):** `docs/plans/2026-10-24-sprint-release-gate-and-sprint-readers.md` on `main`
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2513 merged
- **Branch:** `bug/sprint-readers-misread-goal-and-slug` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

One of four slices. The sibling `bug/sprint-release-gate-ignores-withdrawn-and-partial-reads` already merged (#2576). This branch waits on nothing and nothing in flight waits on it — `bug/story-lint-reduces-link-form-story` and `bug/plot-sprint-verdict-reports-partial-comparison` touch disjoint files. Issue: #2482.

### What to build

Two independent readers, both silently misreading their input:

1. **`sprintGoal` can read a section label as the goal.** `boldGoal` (`packages/domain/src/entities/sprint.ts:203`) takes the first `**bold**` span opening a paragraph under `## Sprint Goal` as the goal text, unconditionally. A hand-written sprint that opens that section with a label paragraph — `**Motivation:** teams on Jira need this.` — has that whole bold span read as the goal, when the typed `> ` line under the title is the actual one-line goal and `## Sprint Goal` only has motivation prose. `packages/domain/test/sprint-goal.test.ts` already pins 16 cases for this function, including the *correct* case where bold wins over a `>` that is motivation (line 35) — so the fix is not "prefer `>` always." It is narrower: a bold span is not the goal when it is a label for what follows, and the existing tests do not cover that shape. Confirm the repro before changing precedence — `sprintGoal(['# Sprint: X', '', '> Ship the thing.', '', '## Sprint Goal', '', '**Motivation:** teams on Jira need this.', ''].join('\n'))` currently returns `'Motivation: teams on Jira need this.'` rather than `'Ship the thing.'`.

2. **`plot-review-status.sh` can read a checkbox mark as a slug.** `ITEM_SLUG=$(echo "$line" | grep -oE '\[([a-z0-9-]+)\]' | head -1 | tr -d '[]' ...)` (`skills/plot/scripts/plot-review-status.sh:39`) matches the FIRST `[...]` on the line — and `- [x] description` has its checkbox mark match that pattern (`[a-z0-9-]+` accepts the single character `x`) before any real `[slug]` annotation does. Confirmed: `echo '- [x] some description' | grep -oE '\[([a-z0-9-]+)\]' | head -1 | tr -d '[]'` prints `x`. The fix must look for `[slug]` only after the checkbox, not from the start of the line.

   **Scope note:** the `set -euo pipefail` abort-on-no-match bug this same script carried (a slug-less line exiting the loop early) is **already fixed** on `main` and pinned by `test/reconcile/review-status-slug-match.test.mjs` (16/16 green on current `main` — verified before writing this brief). Do not re-fix it; the remaining live bug on this script is the `[x]`-as-slug misread above, inside that same matching logic.

### Decisions the plan settles — do not re-derive them

**`board.ts:1463`'s comment is already correct on current `main`.** It reads `// Sprint goal — the domain reads the '> ' line under the title first, then / the first prose paragraph of '## Sprint Goal', and never a '<…>' slot.` The plan's line citation is stale — re-check it against current content before changing anything there; the comment may need no change at all, or a smaller one than the plan assumed (it still doesn't mention the bold-label case, which is the actual precedence rule). The plan's own Open Question says to re-check cited lines; this is the result for this one.

**Resolve the order from the domain function, not from the comment or the changelog phrasing.** The changelog's "`sprintGoal` reads the typed `>` goal before any bold paragraph label" describes the net effect wanted for the Motivation-label case, not a blanket reordering — `sprint-goal.test.ts:35` (bold wins over true `>` motivation) must keep passing. The distinction a correct fix needs to draw is label-paragraph (introduces a sub-topic, text continues after the bold span closes on the same line) vs. goal-paragraph (the whole paragraph IS the bold text, nothing meaningful follows it on that line). Write the new test(s) first against the unfixed code, see them fail, then make the distinction in `boldGoal` or `sprintGoal`.

**The `[x]`/`[slug]` fix changes matching, not architecture.** No new parsing pass, no second script. The annotation-walking `awk` immediately below (line ~46) is unrelated and untouched — it already keys off `<!-- ... -->` content, not the checkbox.

### Done when

The plan's Changelog entries for this slice are the specification:
> `sprintGoal` reads the typed `>` goal before any bold paragraph label.
> `plot-review-status.sh` prints its error JSON for an unknown sprint slug and no longer reads the `[x]` checkbox as a slug.

Re the "prints its error JSON for an unknown sprint slug" clause: verify this is still live too — `SPRINT_FILE=$(ls docs/sprints/*-"${SLUG}".md 2>/dev/null | head -1)` followed by the `-z "$SPRINT_FILE"` check and `echo '{"error": ...}'; exit 0` (lines 14-17) already look correct on current `main`. If it is already fixed, say so in the PR rather than re-touching it, the same way this brief does for the `board.ts:1463` comment.

Also from the Notes: correct the title and comment in `review-status-slug-match.test.mjs` at (plan-cited) lines 176 and 80 — re-check both against current content; line numbers may have moved since the file gained the already-fixed-bug test.

Assertions a naive fix would pass without:
- **A sprint file whose `## Sprint Goal` opens with a label-style bold paragraph** (`**Motivation:** ...` or similar, with prose continuing past the bold close on the same line) alongside a typed `> ` goal — must return the `>` text. Catches a fix that just swaps precedence wholesale and breaks `sprint-goal.test.ts:35`.
- **Re-run `sprint-goal.test.ts` in full after the change** — all 16 existing cases, especially line 35, must stay green. A fix that makes that one fail is wrong, not the test.
- **A checklist line `- [x] description` with no `[slug]` annotation** — must not be read as slug `x`. Catches the exact bug measured above.
- **A checklist line with both a checkbox and a real `[slug]`** (`- [x] [real-slug] description`) — must read `real-slug`, not `x`. Catches a fix that only handles the no-annotation case.
- **An unknown sprint slug** — confirms (or re-confirms, if already covered) that the script exits 0 with the error JSON rather than aborting.

Plus: a changeset (`pnpm changeset`, description first, `bumps:` block last, `plan:` line pointing at this plan file). The board bundle is generated output: do not commit `board-server.mjs` or any rebuilt bundle (`scripts/check-no-bundle-diff.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it selects the related domain vitest run and any reconcile tests naming a changed file. The suites in the `CI suites` config key run in CI; a failure there comes back as a correction. Do not run `pnpm run test:e2e` locally.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches `plot-review-status.sh`, a `.sh` file — if the fix grows its line count, pay for it in the same change (remove shell elsewhere, or tighten the fix itself; the `[x]`-vs-`[slug]` fix should be a regex change, not new lines). The gate stores no number and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`). When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section (`docs/plans/2026-10-24-sprint-release-gate-and-sprint-readers.md:69`). Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/domain/src/entities/sprint.ts` (`boldGoal`/`sprintGoal`), `packages/domain/test/sprint-goal.test.ts`, `packages/board/src/server/board.ts` (the one cited comment, if it still needs a change), `skills/plot/scripts/plot-review-status.sh`, `test/reconcile/review-status-slug-match.test.mjs`, and this plan's `## Slices` annotation for this branch.

It does not own `packages/domain/src/rules/sprint-release.ts` or `sprint-release-gate.ts` (merged already, sibling slice), `skills/plot/scripts/plot-story-lint.sh` or `story-filter-reduced-slug.test.ts` (sibling `bug/story-lint-reduces-link-form-story`), or `skills/plot-sprint/SKILL.md` / `evals/promptfoo/promptfooconfig.sprint-gate.yaml` (sibling `bug/plot-sprint-verdict-reports-partial-comparison`). No file overlap was found between this slice's scope and either sibling as of this branch's creation.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
