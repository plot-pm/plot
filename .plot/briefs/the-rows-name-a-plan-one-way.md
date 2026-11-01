## Implementation brief — every-plan-reference-shows-its-issue (wave Rows)

- **Plan (canonical):** docs/plans/2026-11-01-every-plan-reference-shows-its-issue.md on main
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #2994 merged
- **Branch:** `feature/the-rows-name-a-plan-one-way` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** plot-review on the PR, per repo convention

This branch is the Rows wave. It waits on the Rule wave, `feature/a-plan-reference-is-decided-once` (PR #2996), which **merged 2026-11-01T15:06:28Z** — confirmed on `origin/main`: `packages/domain/src/rules/plan-reference.ts` exports `planIndexOf`, `planReference`, `planRoute`, `planRouteOfDocLink` and the supporting types; `packages/board/src/app/components/PlanReference.tsx` exists with `isPlainPlanClick`. The Panels wave (`feature/the-panels-name-a-plan-one-way`) waits on this one finishing.

### What to build

Today the board builds a `/plan/` link and renders a plan's name separately at about ten sites in `packages/board/src/app/lib/tuple-row.ts` and `packages/board/src/app/lib/agent-rows/`, so two elements naming the same plan can show different text and different link behaviour. This slice routes every ROW-level site through the now-merged `planReference`/`PlanReference` component instead of building its own label or href:

- `planLink` (`tuple-row.ts:486`) and its caller at `:575`
- `tupleFromPlan` (`tuple-row.ts:1294`)
- the slice row's sole-plan link
- the plan head and `PlanLink` (`rows.tsx:354-380`, used at `AgentList.tsx` mixed-group heading ~2162 and unplaced rows ~2694)
- the inferred plan on an issue row (`rows.tsx:2879`) — stays `href: ''`/text-only per the plan's exclusion rule, but should route its shape through the same contract
- the plan-level rows (`agent-rows/plan-level-row.tsx:171`, the `issues: []` literal goes — confirmed present at that line)
- the draft row (`agent-rows/draft-plan-row.tsx:24`-ish, `tupleFromPlan({ ..., issues: draft.issues ?? [] })`)
- the server-emitted idea row fallback: `tuple-row.ts:701`, `name: plan ?? branchLink(row)` — confirmed present. Route this through `planRefOfRow` in `@plot-pm/domain` so an idea row with `plan: ""`/`planFile: ""` resolves via the plan index instead of falling back to the branch link.

`AgentList` needs to receive the plan index (built via `planIndexOf({ cards, drafts })` from payloads the board already holds) and thread it down to the row builders that need it.

### Decisions already settled — do not re-derive them

- **The domain rule exists; this slice is a caller, not a designer.** `planReference(ref, index)` and `planIndexOf(...)` are merged and tested in `packages/domain/test/plan-reference.test.ts`. Do not re-implement label formatting, truncation, or href resolution here — call the rule.
- **`planRefOfRow(row)` is the fix for the idea-row branch-fallback bug.** Measured 2026-11-01 on `idea/a-plan-that-joins-a-sprint` (plan PR #3000): the row read `plan: ""`, `planFile: ""` while its Planning card already held the path and issues, so slot 3 fell back to `branchLink(row)` and showed the raw branch name linked to the git host. `planRefOfRow` returns `{ slug }` for a `kind: 'plan'` row with empty `plan`/`planFile`, which the index then resolves. This is the one path in this slice with a correctness fix attached, not just a refactor — test it explicitly (see `Done when` table rows for "An idea row before/with no card").
- **A reference with its own `file` links before the index resolves.** Do not gate the href on the index being loaded — `planReference` already returns `href` from the reference's own file first. Rows that carry `row.planFile` today keep their link immediately; this is why `plan-link-click.browser.test.ts:97-140` is explicitly **not** edited by this slice (per the plan). If you find yourself editing it, you've broken this invariant — revert and re-check.
- **Scope exclusions are settled, not up for reinterpretation:** a slice's own name (`tupleFromSlice`) stays plain text — three sibling slices must not all link to the one document they share. A branch row grouped under a plan head stays with no plan link — the head one line up already carries it (`agents-tab.browser.test.ts:545-557` stays unchanged). Text inside a button/menu stays plain text — an `<a>` inside a `<button>` is invalid HTML.
- **`TupleLink` now carries the plan file directly.** `TupleRow.tsx:414` currently decodes the file back out of the href (`decodeURIComponent(link.href.replace(/^\/plan\//, ''))`) — confirmed present. This slice removes that decode by having the row carry the file as a field instead of encoding/decoding it through the URL.
- **Correct the stale comment.** `tuple-row.ts` around line 1326 says a gate asserts *"One import, and it is the contract's types"* — confirmed present, referring to the `UNNAMED_SLICE` re-export rule. This comment currently reads as if it constrains calling `planReference`; it doesn't (that gate is about not importing contract behaviour, not about using the new domain rule). Fix the comment's phrasing so it doesn't mislead the next reader; don't touch the gate itself.
- **Delete, don't deprecate.** `planLink` and `planNameLabel` in `tuple-row.ts`, the slice row's inline href, the duplicate href in `tupleFromPlan`, and `PlanLink`'s `target="_blank"` new-tab mode are all deleted outright once their callers move. No feature flags, no "kept for compatibility."

### Done when

The plan's `## Done when` table is the specification — rows tagged `Rows` in that table are this slice's rows (domain-unit rows tagged `Rule` are already proven on main; don't re-run them, but don't contradict them either). In particular:

- Every row projection (`tupleFromRow`, `tupleFromSlice` sole plan, `tupleFromPlan`, plan-level, draft row) fed issues `['1089']` shows label `1089: <slug>` and href `/plan/<file>` — tested in `tuple-row.test.ts`.
- An idea row before the scan (`plan: ""`, `planFile: ""`, draft card resolves) shows `7: a`, href `/plan/2026-11-01-a.md`, no branch name in slot 3 — domain unit (already covered by the merged Rule slice's `planRefOfRow` tests) **and** `tuple-row.test.ts` wiring it through `tupleFromRow`.
- An idea row with no card yet: label `a`, href `''`, branch kept in slot 4 — `tuple-row.test.ts`.
- A slice's own name stays text: `tuple-row.test.ts:469` (approximate; confirm the current line) stays unchanged — don't touch this assertion.
- A plan-level or branch row links before `/api/board` loads: `plan-link-click.browser.test.ts:97-140` stays **unchanged** — this is CI's test, not yours to edit.
- The prefix appears once the index loads (fleet row with `planFile`, no cards yet, then cards arrive with issues): board unit test over `planIndexOf`.
- A grouped branch row has no plan link: `agents-tab.browser.test.ts:545` stays unchanged.

Plus the repo's gates: no bundle in the diff (`scripts/check-no-bundle-diff.sh`), changeset present if this ships a user-visible change, and `scripts/check-plan-routes.sh` — **note this gate is added by the next slice (Panels), not this one**, so don't expect it to catch a stray `/plan/` template literal yet; self-review for that instead. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — the suites named in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite here.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grew past its merge base — this slice is pure TypeScript/TSX, so it shouldn't touch shell, but if a helper script needs a line, pay for it in the same change.

### Bookkeeping

Open the PR through the controller once real commits exist:

```bash
../plot/scripts/plot-open-pr.sh          # current branch
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```

It reads the plan's wave heading ("Rows") for the PR title and body. Do not run `gh pr create`. When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section (the `### Rows` heading), in the same commit style as the Rule slice's `→ #2996`.

Push the first real commit as soon as it exists so the branch isn't silently idle.

### Scope guard

This branch owns: `packages/board/src/app/lib/tuple-row.ts`, `packages/board/src/app/lib/agent-rows/rows.tsx`, `packages/board/src/app/lib/agent-rows/plan-level-row.tsx`, `packages/board/src/app/lib/agent-rows/draft-plan-row.tsx`, `packages/board/src/app/components/AgentList.tsx`, `packages/board/src/app/components/TupleRow.tsx` (the decode removal), and the tests at `packages/board/test/unit/tuple-row.test.ts` plus the browser assertions on plan labels this slice owns (not `plan-link-click.browser.test.ts` or `agents-tab.browser.test.ts:545`, which stay unchanged per the plan).

The next wave, Panels (`feature/the-panels-name-a-plan-one-way`), owns `PlanCard`, `PlanModal`, `StoryModal`, `SprintModal`, `AgentPanelFacts`, `WorkerLogModal`, `Swimlanes`, `server/board.ts`'s doc-link rewriter, `App.tsx`'s three `location.assign` fallbacks, and the new `scripts/check-plan-routes.sh` gate — do not touch those files or add that gate here; it waits on this slice merging first.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
