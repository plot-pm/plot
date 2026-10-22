## Implementation brief — plot-review-status-sh-reads-the

- **Plan (canonical):** `docs/plans/2026-10-22-plot-review-status-sh-reads-the.md` on `main`
- **Approved:** 2026-10-22, Jan Wloka, plan-PR #2328 merged
- **Branch:** `bug/plot-review-status-sh-reads-the` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is the only slice. Nothing waits on it and it waits on nothing.

### What to build

`plot-review-status.sh <sprint-slug>` reads every line of a sprint file, not only its checklist items, and that is two separate defects measured on ewz-kus-portal's `kafka-gp-sync` sprint (round 7, main `da789acff`):

1. **A phantom item.** `skills/plot/templates/sprint.md:50` carries the scope-change format comment `<!-- Format: - YYYY-MM-DD: Added/Moved/Removed [slug] reason -->`. That single HTML-comment line matches both extraction patterns at `skills/plot/scripts/plot-review-status.sh:32` (`\[([a-z0-9-]+)\]` finds the literal `[slug]`) and `:36` (`<!--.*-->` matches the whole line as its own annotation). Every sprint built from the template therefore reports one bogus item, `{"slug":"slug","pr":"none",…,"needs_review":true}`.
2. **A plan-less item is silently dropped.** An item such as `EWZKUS-3869 <!-- pr: #3663, branch: … -->` carries no `[slug]` at all, so `:33`'s `[ -z "$ITEM_SLUG" ] && continue` skips it before the annotation is ever read — its PR gets no review-freshness reading even though it has a `pr:` annotation to parse.

#2303 (delivered 2026-10-21) fixed the exit-1-on-no-match crash by adding `|| true` to the slug extraction. That fix made the no-match case survive as an ordinary skip — which is exactly what now makes the template's comment line and a plan-less item behave identically wrong instead of crashing. Fixing this bug does not touch `|| true`; it narrows which lines reach the extraction in the first place. The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**Filter on line shape before any extraction runs.** The plan's Design section is explicit: process a line only when it matches `^[[:space:]]*- \[[ xX]\]` (a checklist item). Apply that filter as a guard at the top of the loop body, before the `ITEM_SLUG` extraction at `:32`. A comment line or prose line then never reaches either `grep -oE` call — it is not that the regexes become stricter, it is that they stop seeing lines they were never meant to parse. This is why the fix is a pre-filter rather than a tighter `\[([a-z0-9-]+)\]` pattern: the template's placeholder text `[slug]` is a syntactically valid slug by any character-class test, so no slug regex alone can distinguish it from a real one. Only the line's checklist shape can.

**An item identifier is `[slug]` when present, otherwise the item's own key or text.** Take the leading key/text — the content after the checkbox and before the first `<!--`, trimmed — for a plan-less item. Keep the output's field name `slug` for both cases unless you find an actual consumer that needs to distinguish a plan item from a plan-less one by field name rather than by value shape. `skills/plot-sprint/SKILL.md:308` is the only in-repo consumer and reads the JSON generically ("review freshness for all sprint items") — it names no field by which it branches on plan vs. plan-less, so there is no settled consumer forcing a new field. The plan leaves this as an open question for you to close in Design, not a decision already made; record what you chose and why.

**#2303's `|| true` guard stays untouched, and the new filter does not replace it.** The pre-filter stops irrelevant lines from reaching the extraction; `|| true` still protects the extraction itself on a checklist line that happens to carry no annotation (an item with no `pr:` comment at all) or no slug (a plan-less item, now correctly reaching the annotation test instead of being filtered out earlier by the *old*, wrong gate). Removing `|| true` reintroduces the crash #2303 fixed; removing the new shape filter reintroduces both bugs this plan fixes. They guard different things.

**Rule carried over: absent is not false, and a pipeline's exit code is not its emptiness.** `grep` finding no match on a non-checklist line is not an error to swallow — it is a line that should never have been asked the question. Filtering by line shape is answering that correctly rather than papering over a failed extraction.

### Done when

The plan's `## Slices` entry is the specification: filter to checklist lines, report plan-less annotated items by key or text, and add the contract tests. Extend `test/reconcile/review-status-slug-match.test.mjs` per the plan's Design section — it already holds the sandbox-repo harness and the no-origin-branch pattern from #2303; add to it rather than starting a second test file for the same script.

Lift these assertions, because a naive fix passes without them:

- **A sprint built from `skills/plot/templates/sprint.md` produces `items: []`.** Build the sandbox sprint body from the template's actual scope-change comment line (`<!-- Format: - YYYY-MM-DD: Added/Moved/Removed [slug] reason -->`), not a hand-written approximation — a paraphrase could accidentally stop matching the old buggy regex and pass for the wrong reason.
- **A plan-less item with a `pr:` annotation appears in the output, keyed by its own text/key, not dropped and not merged into another item's entry.** Assert its `pr`, `branch`, and `needs_review` fields parse the same way an annotated plan item's do.
- **A plan item with `[slug]` and an annotation still works exactly as before** — this is a regression guard for #2303's existing coverage, not new behavior.
- **A non-checklist line carrying `[` and `]` characters that happen to look like a slug (the template comment is the real-world case) is never reported as an item**, whether or not it also carries an HTML comment.
- **Clear `PLOT_UNATTENDED` and `PLOT_REPO_ROOT` in the test's environment**, matching the existing tests in this file. Worker env leaks into sandbox tests is a known failure on this estate.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite. Do not run `test:e2e` locally.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. A pre-filter line added to the loop is new shell; if the net count under `skills/` grows, remove an equal number elsewhere in the same change, or write the filter so it replaces rather than adds (e.g. folding the shape check into the existing `while` condition). The gate stores no number and has no override.

New test code uses arrow functions, not `function` declarations. Add a `.changeset/*.md` for package `plot` with the description first and the `bumps:` block last (`plot-sprint: patch` if `skills/plot-sprint/SKILL.md` changes, otherwise only the `plot` package line).

Run `./scripts/check-helper-table.sh` if you touch the helper README. Do not edit `skills/plot/scripts/board/board-server.mjs`; the change does not need a board build.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-review-status.sh`, `test/reconcile/review-status-slug-match.test.mjs`, and one changeset. It may also touch `skills/plot-sprint/SKILL.md` only if the output's field shape for a plan-less item changes (see the open question above) — otherwise leave it alone. It touches no other script, no `packages/`, and no plan or sprint file other than the `→ #<number>` annotation.

Branches in flight that touch nearby files: `bug/plot-review-status-sh-exits-1` already merged (#2303, delivered) — verify with `git log origin/main -3 -- skills/plot/scripts/plot-review-status.sh` before you start, since that history is now the starting point rather than a concurrent branch. If you find something the plan did not anticipate, report it rather than improvising outside scope.
