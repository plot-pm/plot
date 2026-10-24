## Implementation brief — this-sprint-cannot-select-one-sprint (wave 2: Board UI)

- **Plan (canonical):** `docs/plans/2026-10-23-this-sprint-cannot-select-one-sprint.md` on `main`
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2413 merged
- **Branch:** `bug/this-sprint-selects-a-sprint-subset-ui` (base: `main` — wave 1 has merged; see Bookkeeping)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Wave 1, `bug/this-sprint-selects-a-sprint-subset-rule`, has merged to `main` (PR #2466, `75c41cd8a`). This branch imports `slugPassesSprintFilter`, `rowIsSprintExempt`, `sanitizeSelection`, `rowInSprintSelection` and `showsSprintSlug` from `@plot-pm/domain/rules/sprint-selection` — the names and signatures below are confirmed against the merged file, not a placeholder.

### What to build

With several sprints Active, the Delivery tab's «This sprint» chip shows the items of all of them, because the chip is all-or-nothing against the whole Active set — there is no way to pick one sprint. Observed 2026-10-23 in ewz-kus-portal: `kus-portal-103` and `kus-portal-103-markus` are both Active, share no plan, and a reader who wants only `kus-portal-103` sees the other sprint's five plans too, with no row saying which sprint it belongs to.

This branch is the UI half: it turns the chip row's current all-or-nothing toggle into a true subset selector, puts the selection in the URL, and shows a row's sprint slug when more than one sprint is on screen at once. The rule half is already built in `@plot-pm/domain`; this branch is the only one that touches `AgentList.tsx` beyond import lines, and the only one with a UI diff.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**The selection is a `Set<string>` of Active sprint slugs today, and it already lives in `AgentList.tsx`.** `sprintFilter` (`AgentList.tsx:567`) is the stored state; `selectedSprints` (`:627`) is its sanitized derivation through `sanitizeSelection`; `sprintFilterOn` (`:633`) is `selectedSprints.length > 0`. None of this storage changes shape — what changes is how it is set (per-sprint, not all-or-nothing) and where it lives (URL, not component state only).

**`toggleThisSprintChip` (`:640`) is the thing to replace, not extend.** Today it calls `selectAllSprints(sprintFilterOn ? [] : sprintSelectAll.selection)` — on means "every Active sprint", off means "none". A per-sprint click needs its own setter that adds/removes one slug from the selection; the «This sprint» chip's own click can keep today's all-or-toggle meaning (per Decision below) but must go through the same setter path, not a second code path that can drift from it.

**The rendered rows already compute `inSprint` by hand — replace both call sites with the domain's row-membership rule, do not keep the local computation beside it.** `filteredRows` (`:661-664`) and `chipRowReadings.sprint.visibleRows` (`:697-701`) each inline `rowIsSprintExempt(r) || slugPassesSprintFilter(...)`. That is exactly the body of `rowInSprintSelection(row, selected, membership)`, confirmed in the merged `sprint-selection.ts` — call it at both sites instead of inlining the two-function check again. Both sites must call the same rule so the filter and the chip's own count cannot disagree about which rows are in the selection — the comment at `:670-679` already states that invariant for the current pair and it holds for the replacement.

**One toggle chip per Active sprint, beside «This sprint» — not instead of it, per Decision table row "Sprint line as control or chip row".** #2080 kept the chip row as the one control surface; this plan does not reopen that. While `activeSprints.length > 1`, render one additional chip per Active sprint; with one Active sprint, the chip row is unchanged (no per-sprint chips, «This sprint» alone, exactly as today).

**`data-chip` is a stable key, independent of the label.** The «This sprint» chip keeps `data-chip="This sprint"` even when its label starts naming a sprint (see below) — four browser test files select it and must keep working unmodified. Each per-sprint chip carries `data-chip="sprint:<slug>"`. Test this directly: a label change must not be visible to a `data-chip` selector.

**The «This sprint» chip's label names the sprint when exactly one is selected.** No other label changes. Decide the exact wording against the plan's Motivation section and the existing `sprintSelectAll.sentence` pattern (`lib/filters.ts:187-194`, e.g. `"Select all N Active sprints."`) for voice, but the label itself is new — the plan does not fix its text.

**The selection is a URL parameter, read and written the way the Planning tab already does it — do not invent a second mechanism.** `App.tsx:284` (`readList('sprint')`) and `:1040` (`writeList('sprint', values)`) are the existing pair, imported from `./lib/filters.js` (`readList`/`writeList`, `filters.ts:183-202`; comma-separated, trimmed, falsy-filtered). The Delivery tab's `sprintFilter` state in `AgentList.tsx` currently has no URL sync (`:562-566` states why it didn't, under the old all-or-nothing design) — that comment is now wrong and must be corrected or removed, not left to contradict the new behavior. Read the initial selection from `readList('sprint')` and write every change through `writeList('sprint', …)`, matching the Planning tab's param name only if the two tabs are meant to share one selection — check whether the plan or the Planning-tab code implies a shared vs. independent `sprint` param before reusing the literal key; if ambiguous, treat the Delivery tab's parameter as independent and name it distinctly (e.g. not clobbering the Planning tab's own `sprint` list) — this is a real open question the plan does not settle explicitly beyond "a sprint selection is a view ⇒ URL", and a reviewer will ask about it if shared state looks accidental rather than argued.

**`sanitizeSelection` already guards a stale URL slug.** A `?sprint=` value naming no Active sprint must collapse to "no filter", not "nothing matches" — this is wave 1's existing contract (`sprint-selection.ts`), already exercised by `selectedSprints` (`:627-628`). Keep routing every read of the stored selection through it; do not add a second, unsanitized read path for the URL-sourced value.

**An open board still follows a sprint change.** The effect at `:656-659` already prunes a dropped slug from `sprintFilter` once `activeSprints` no longer contains it; verify this still holds once the selection's source of truth includes the URL, and that `sanitizeSelection`'s "collapse-to-empty" result propagates back into the URL (an all-stale URL param becomes `?sprint=` cleared, not left stale on screen while rows read as unfiltered).

**Every other reader of the selection moves with the mechanism change, not around it.** The plan names these explicitly and this slice covers them: `workersHiddenByFilter` (`:739`), the per-section hidden counts (`:1025`, `:1059-1060`, and the `unfilteredSectionedRows` block feeding both), and the exempt-mark / chip-row wiring at `:692-712`. None of these are optional cleanup — a subset selection that only updates `filteredRows` but leaves a hidden-count computed against the old all-or-nothing assumption will show a wrong number the moment two Active sprints both have hidden rows.

**Row sprint slug: `showsSprintSlug(activeSprintCount, selected)`, confirmed in the merged `sprint-selection.ts`.** True while `activeSprints.length > 1` and `selected.length !== 1`. The row shows `AgentRow.sprint` (`schema.ts:71`, server-set at `fleet.ts:6059`); the payload shape does not change, so this is read-only wiring into row rendering, not a schema change. A row in two Active sprints shows the first sprint the server already picked — do not build multi-sprint display; the motivating ewz sprints share no plan, so this case cannot be measured here.

**Estate totals stay unfiltered; this slice does not touch `estateTotals` (`fleet.ts:7066`).** Only rows and the per-section hidden counts scope to the selection.

**The Planning tab's own sprint badge is a separate reader and out of scope.** `Board.tsx:177` and `Swimlanes.tsx:124` gate on `sprintSel.length === 0`; this plan does not change that rule or that tab.

**One browser test restores what #2137 removed.** The plan calls for a browser test proving the subset selection actually filters rows end-to-end (not just a unit test of the domain rule) — `packages/board/test/integration/agents-tab.browser.test.ts` is where the four existing `[data-chip="This sprint"]` assertions live; add the subset case there rather than a new file, so the per-sprint and «This sprint» interactions are exercised together.

Rules carried over, unchanged:

- `packages/domain/**` is arrow functions and factual TSDoc; this branch is `packages/board/**` code, which keeps its existing (function-declaration-heavy) style — do not convert surrounding board code you are only passing through.
- Absent is not false: an empty selection is "no filter", never "nothing selected matches" — this is the same invariant wave 1's rules already encode; a UI bug here is reading `sprintFilter.size` directly instead of the sanitized `selectedSprints` derivation.
- Read the exit code, not the emptiness.

### Done when

The plan's `## Slices` line for this branch is the specification: per-sprint toggle chips, the URL parameter, the chip label, and the row slug, covering every reader of the selection (`workersHiddenByFilter`, the per-section hidden counts, `unfilteredSectionedRows`, the exempt mark). URL parse and the stale-slug case are unit tests; one browser test restores the subset test #2137 removed.

Assertions that exist because a naive implementation would pass without them:

- **Two Active sprints, one selected via its own chip:** rows of the other sprint are hidden, and the «This sprint» chip's own label names the selected sprint. A naive per-sprint toggle that forgets to update `sprintFilterOn`'s downstream readers will filter rows correctly but leave the chip row's count stale.
- **`data-chip="This sprint"` still resolves after the label changes.** This catches an implementation that derives the test selector from the label text instead of keeping it a fixed attribute.
- **A stale `?sprint=` slug on load reads as "all Active sprints", not "zero rows".** Exercises `sanitizeSelection` on the URL-sourced value specifically, not just on the in-memory `Set`.
- **One Active sprint:** the per-sprint chips do not render at all, and the «This sprint» chip behaves exactly as before this plan. Catches an implementation that always renders N chips, including N=1.
- **Reload with a selection in the URL restores the same rows hidden/shown**, proving the read path (`readList`) and the write path (`writeList`) agree on the parameter name and format.
- **A row in exactly one Active sprint, with that sprint the only one selected, shows no sprint slug** — `showsSprintSlug`'s `selected.length !== 1` arm. Catches a naive implementation that keys only off `activeSprintCount`.

Plus the repo gates: a changeset in `.changeset/` for `@plot-pm/board` (this slice changes board behaviour). No generated bundle in the diff (`scripts/check-no-bundle-diff.sh`). For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run a full suite, and do not run `test:e2e` locally. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` does not apply — if a later revision does touch one, that growth must be paid for in the same change.

### Bookkeeping

**Wave 1 has merged — branch from current `main`.** `bug/this-sprint-selects-a-sprint-subset-rule` merged via PR #2466 ("Selection rule") at `75c41cd8a`. This wave is eligible now; `plot-fleet-scan.sh --next` will hand it out. Create `bug/this-sprint-selects-a-sprint-subset-ui` from `origin/main`, not from any local wave-1 commit.

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: the chip-row rendering and the `sprintFilter`/URL-sync state in `AgentList.tsx`, the two `inSprint`/row-membership call sites it replaces, the row-slug rendering wherever `AgentRow.sprint` is displayed, and its own new test cases in `packages/board/test/unit/agent-list.test.ts` and `packages/board/test/integration/agents-tab.browser.test.ts`. It does not own `packages/domain/src/rules/sprint-selection.ts` or `packages/board/src/app/lib/filters.ts` — those are wave 1's, already merged.

In flight beside it: no other branch of this plan runs — this is the only remaining slice. Verify with `/plot-pulse` before you start.

If you find something the plan did not anticipate, report it rather than guessing or inventing a parallel implementation.
