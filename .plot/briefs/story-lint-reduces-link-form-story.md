## Implementation brief — sprint-release-gate-and-sprint-readers (wave: Story lint)

- **Plan (canonical):** `docs/plans/2026-10-24-sprint-release-gate-and-sprint-readers.md` on `main`
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2513 merged
- **Branch:** `bug/story-lint-reduces-link-form-story` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

One of four waves. The sibling `bug/sprint-release-gate-ignores-withdrawn-and-partial-reads` already merged (#2576). This branch waits on nothing and nothing in flight waits on it — the sibling `bug/sprint-readers-misread-goal-and-slug` and `bug/plot-sprint-verdict-reports-partial-comparison` touch disjoint files.

### What to build

`plot-story-lint.sh`'s S5 check silently stops finding drift for any plan that writes `Story:` as a Markdown link. The index it builds (`plan_phases`, `skills/plot/scripts/plot-story-lint.sh:99-105`) reads the field with its own inline awk:

```awk
/^- \*\*Story:\*\*/ { s=$0; sub(/^[^:]*:\*\*[ \t]*/, "", s); gsub(/[ \t]+$/, "", s); story=s }
```

That keeps the raw value — `[kanban-board](docs/stories/kanban-board/STORY-kanban-board.md)` stays a link. Later, S5 (`:170`) matches `plan_phases` against the story directory's bare name: `awk -v s="$base" '$1 == s { print $2 }'`. A link never equals a slug, so the match fails, `phases` comes back empty, `drift` is never computed, and S5 reports nothing for that plan — not a wrong verdict, a missing one, and silent because S5 is advisory (exit 0 either way; see the header's EXIT note).

`plot-plan-meta.sh` already solved this for its own `story` field: `reduce_story_link()` (`plot-plan-meta.sh:452`) reduces `[text](target)` to `text`, called at both read sites (front matter `:1075`, `## Status` block `:1190`). The fix is to make `plot-story-lint.sh` produce the same reduced value, so S5's string comparison has a chance of matching.

### Decisions the plan settles — do not re-derive them

**The Design section names the preferred direction, and it has a real cost the plan already weighs.** `plot-story-lint.sh`'s own comment at `:80-82` explains why it doesn't just call `plot-plan-meta.sh` per plan: ~0.28s per plan × 222 plans in this repo ≈ a minute, and "a lint that took a minute would not be run." The plan's Open Question 2 leaves both paths open:
- Call `plot-plan-meta.sh` (or a shared awk function) for `Story:` — removes the duplicate reader, pays the per-plan cost.
- Keep the inline awk, add the same link-reduction logic inline — changes less, keeps the existing performance shape, but is a **second implementation of `reduce_story_link()`** that can drift from the first.

Given the plan's own prior comment rejects the per-plan subprocess cost and nothing in this issue's findings says that measurement is wrong, the lighter fix — port `reduce_story_link()`'s regex into `plot-story-lint.sh`'s inline awk (or extract it to a tiny shared awk snippet both scripts source) — satisfies the Changelog's one-line spec ("`plot-story-lint.sh` reduces a Markdown link in `Story:` ... preferably by asking the same reader rather than a second awk") without reintroducing the per-plan cost this script was written to avoid. If you choose to call `plot-plan-meta.sh` instead, the per-plan cost claim is nearly four years stale by file-count growth alone — re-measure it against current plan count before accepting the regression, and say in the PR body which path you took and why.

**A malformed link stays unreduced, and that is intentional — match it.** `reduce_story_link()`'s own comment (`plot-plan-meta.sh:448-451`) is explicit: `[text](` with no close, or `[]()`, is not a real link, and keeping the raw value lets an empty `story` mean "no story" rather than conflating it with "malformed." Whatever regex you port must preserve that same malformed-link passthrough, not just the happy-path reduction — a corpus test comparing the two awk implementations (if you keep two) should assert this case explicitly, since it is the one most likely to silently diverge between a hand-ported regex and the original.

**This is a shell-only fix; no domain code changes.** `plot-story-lint.sh` is bash+awk with no TypeScript involvement — the Layering Rule and domain-package rules in `CLAUDE.md` do not apply here. Do not route this through `@plot-pm/domain`; the cost-of-a-shell-caller tradeoff above is the actual design question, not a layering one.

**`plot-plan-meta.sh:108`'s `story` field description is stale and the plan calls it out.** It reads "story slug the plan belongs to (`## Status` `Story:` or front matter `story:`); '' if absent or a placeholder" — true, but it doesn't mention that the field is *reduced* from a Markdown link form, which is exactly the behavior this slice is making `plot-story-lint.sh` match. Update the comment to say so.

### Done when

The plan's Changelog entry for this slice is the specification:
> `plot-story-lint.sh` reduces a Markdown link in `Story:` like `plot-plan-meta.sh`, so check S5 covers link-form plans.

Assertions a naive fix would pass without:
- **A plan with `Story:` written as a Markdown link, under a STORY directory whose bare slug matches the link's text** — S5 must now find and report drift for it if the plan's phase disagrees with the story's written status. Catches a fix that reduces the display somewhere else but leaves the `plan_phases` index keyed on the raw link.
- **A plan with `Story:` written as a plain slug (no link)** — must behave exactly as before. Catches a fix that breaks the existing non-link path.
- **A malformed link value** (`[text](` unterminated, or `[]()`) — must stay unreduced, matching `reduce_story_link()`'s own documented behavior. Catches a regex port that accidentally reduces or blanks a value the original function treats as "not a link."
- **`story-filter-reduced-slug.test.ts` currently synthesizes `card.story` directly via the `card()` test builder** (`packages/board/test/catalogue/build.js`) — it never calls a parser at all. The plan's Design line says this test should "run the parser." Make it exercise the actual reduction path (either by calling `plot-plan-meta.sh` against a fixture plan file and asserting the parsed `story` field, or an equivalent that actually invokes `reduce_story_link()`), rather than continuing to assume the reduction already happened. The existing two `it()` blocks test board-side consumers (filter, lane grouping) of an already-reduced `card.story` — keep those, and add coverage that the reduction itself happens, since nothing today does.

Plus: a changeset (description first, `bumps:` block last, optionally a `plan:` line pointing at this plan file). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it selects the related tests for whatever package you touched. The suites in the `CI suites` config key run in CI; a failure there comes back as a correction. Do not run `pnpm run test:e2e` locally.

**`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base.** This slice touches `plot-story-lint.sh`, a `.sh` file. If porting (or sharing) the reduction logic grows the line count, pay for it in the same change — trim elsewhere in the touched file, or, if you extract a shared awk snippet both scripts source, confirm the net line count still fits (an extraction can grow total lines even while removing duplication, if the extracted file adds its own header/comments). The gate stores no number and has no override.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (use `--draft` while the work moves); never `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices` section (`docs/plans/2026-10-24-sprint-release-gate-and-sprint-readers.md:74`). Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `skills/plot/scripts/plot-story-lint.sh`, `skills/plot/scripts/plot-plan-meta.sh:108` (the `story` field doc comment only — not its parsing logic, which this slice must not change), `packages/board/test/unit/story-filter-reduced-slug.test.ts`, and this plan's `## Slices` annotation for this branch.

It does not own `packages/domain/src/entities/sprint.ts`, `packages/board/src/server/board.ts`, or `skills/plot/scripts/plot-review-status.sh` (sibling `bug/sprint-readers-misread-goal-and-slug`); `packages/board/src/server/entry/sprint-release-gate.ts` or `packages/domain/src/rules/sprint-release.ts` (merged sibling, #2576); or `skills/plot-sprint/SKILL.md` / `evals/promptfoo/promptfooconfig.sprint-gate.yaml` (sibling `bug/plot-sprint-verdict-reports-partial-comparison`). No file overlap was found between this slice's scope and either sibling as of this branch's creation.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
