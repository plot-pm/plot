## Implementation brief — every-plan-reference-shows-its-issue (wave 1: Rule)

- **Plan (canonical):** docs/plans/2026-11-01-every-plan-reference-shows-its-issue.md on main
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #2994 merged
- **Branch:** `feature/a-plan-reference-is-decided-once` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** pr

Three branches wait on this one: Rows (`feature/the-rows-name-a-plan-one-way`),
then Panels (`feature/the-panels-name-a-plan-one-way`), then Fleet index
(`feature/the-fleet-payload-indexes-its-plans`, which also waits on a
different plan's `feature/the-scan-script-is-a-launcher`). Nothing in this
plan waits on this slice's own prerequisites — it is the first wave. Land it
clean: every later slice imports what this one exports.

### What to build

Today the board builds a plan reference — its label and its `/plan/<file>`
link — independently at about 10 call sites, each with its own text and link
logic. Two consequences are visible right now: a reader cannot tell that two
elements name the same plan (label and link both vary site to site), and the
plan-level verify/design/spec rows pass `issues: []` (`plan-level-row.tsx:168`)
so a plan loses its issue number there even when it has one.

This slice builds the one domain rule everything else in the plan will call.
It does not touch any call site — that is Rows and Panels. It builds:

1. `packages/domain/src/rules/plan-reference.ts` — pure, synchronous, arrow
   functions, factual TSDoc only (CLAUDE.md: "Every rendered state is a domain
   property", "the domain here takes readings as values, not ports"). No port
   import, no await.
   - `planIndexOf({ cards, drafts, fleetPlans })` → `PlanIndex` keyed by file
     basename and by slug. Entry shape: `{ slug, title, file, issues }`. Every
     input optional — a caller passes what it has. `fleetPlans` is unused until
     slice 4 but the parameter exists now so Rows/Panels can call with partial
     data without a signature change later.
   - `planReference(ref, index)` → `{ label, issues, title, href, exists }`.
     `ref` names the plan by `file` or `slug`, and may carry its own `issues`
     (used today only by the inferred plan on an issue row, `rows.tsx:2879`).
     The index entry's `issues`/`title` win over the reference's own when both
     exist.
   - `planRoute(file)` → `/plan/<encoded basename>`. Splits on `/` **and** `\`
     (today's `planHref`, `lib/plan.ts:13-16`, has the Windows case already —
     port its test, don't re-derive it).
   - `planRouteOfDocLink(href)` → rewrites a relative doc-body link
     (`../../plans/2026-08-16-slug.md` → `/plan/slug.md`;
     `../stories/<slug>/STORY-*.md` → `/story/<slug>`; anything else passes
     through unchanged). Replaces two duplicate regex copies
     (`StoryModal.tsx:12-23`, `server/board.ts:3182-3194`) — Panels slice wires
     the callers, this slice only builds the function.
   - Reuse `planLinkClick` (`rules/plan-link-click.ts:26`) for the click
     outcome from inside `planReference`'s consumers — do not restate its
     open/wait/navigate logic here.
2. `packages/board/src/app/components/PlanReference.tsx` — renders a
   `planReference()` answer and decides nothing else.
   - With `href`: real `<a href>`. Without: `<span>`. Keeps
     `data-tuple-link="plan"` / `data-tuple-text="plan"` (6 browser selectors,
     5 files, read these) and adds `data-plan-ref`.
   - Prefix span is `shrink-0`; slug span is `truncate` with `min-w-[8ch]` —
     the prefix never truncates, the slug gives way down to 8 visible chars.
   - `title` attribute = full label + " — " + plan title. Accessible name =
     `Plan <label>` (today's `linkLabel` shape, `TupleRow.tsx:290-295`) — must
     start with the visible text.
   - Plain click / Enter calls `onOpenPlan(file): boolean`; `true` prevents
     navigation. Cmd/Ctrl/Shift/Alt/middle-button click is never intercepted.
     Component never sets `target`.
3. `packages/domain/test/plan-reference.test.ts` — every row of the Done-when
   table tagged "Rule" (16 rows), including:
   - the `planNameLabel` cases moved from
     `packages/board/test/unit/a-plan-row-names-its-ticket.test.ts:84-99`
     (verbatim move, not duplicated, not deleted — the old file loses these
     lines in this same slice)
   - the Windows-path case moved from
     `packages/board/test/unit/plan.test.ts:21`

### Decisions the plan settles — do not re-derive them

**Label shape is `<keys joined by ", ">: <slug>`, title is tooltip-only.**
All four review-panel jurors independently converged on slug-as-identity
(it's the string branches, slices, the sprint file and the route already
share) over title (longer, truncates first, not shared across surfaces). Do
not propose showing the title inline — this was litigated and closed in
`.plot/panels/every-plan-reference-shows-its-issue/panel.md`, panel round 1.

**Issue keys normalize to strings, `#` stripped, blanks dropped, dedup
keeps first occurrence.** `String(n)` matches `schema.ts:3572`'s
`issueKey` form exactly — do not invent a second normalization. A GitHub
number prints bare (`1090`), a Jira key prints as stored (`EWZKUS-3430`).

**A reference with its own `file` links immediately, before the index
resolves anything.** This was a HIGH finding from `plot-review` on the
pre-amendment commit (941c0e4aa) — the first draft had every reference wait
on index resolution, which would have regressed a Delivery row's existing
day-one link. `href` priority: reference's own `file` → index's resolved
file → `null`. Only the issue-prefix and title wait on the index; the link
does not.

**No helper site migrates in this slice.** Rows and Panels slices do the
call-site surgery and helper deletion (`planLink`, `planNameLabel`,
`planHref`, `rewritePlanLink`, `rewritePlanLinks`). This slice adds new code
alongside the old without touching a single existing call site — if you find
yourself editing `tuple-row.ts` or `StoryModal.tsx`, stop, that's out of
scope for this branch.

**`scripts/check-plan-routes.sh` and its CI wiring are NOT this slice.**
The plan assigns the gate script and the CI step to Panels (it depends on
every call site having moved first, or the gate would fail on the sites this
slice deliberately leaves alone). Do not add the gate here.

**Carried-over invariant:** absent is not false — read exit codes, not
emptiness, anywhere this rule's callers check `href` or `exists`.

### Done when

The plan's `## Done when` table rows tagged `Rule` (16 rows) are the
specification — each names its exact input/expected/test. Two worth calling
out because a naive implementation passes without them:

- **"Two plans sharing a key stay distinguishable"** — proves the 8-char
  slug floor actually survives truncation CSS, not just that the prop is set.
- **"A reference with its own file links before the index"** — proves the
  priority order above, not just that *some* href comes back.

Plus: no generated bundle in the diff (`scripts/check-no-bundle-diff.sh`).
Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push
and run what it prints — the CI suites in the `CI suites` config key run in
CI; a failure there comes back as a correction. List no full suite.

`scripts/check-shell-lines.sh` ratchets shipped shell length against this
branch's merge base — this slice touches no `.sh` file, so it should cost
nothing here; if that changes, say so in the brief for whoever picks up next.

### Bookkeeping

Open the PR through the controller once the first real commit exists:
`skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`). Push that first
commit as soon as it exists, don't wait for the whole slice.

When the PR is created, append `→ #<number>` to this branch's line under
`### Rule` in the plan's `## Slices` section.

### Scope guard

This branch owns, and only:
- `packages/domain/src/rules/plan-reference.ts` (new)
- `packages/domain/test/plan-reference.test.ts` (new)
- `packages/board/src/app/components/PlanReference.tsx` (new) + its own unit
  test (new)
- the package export in `packages/domain/src/index.ts` (one new `export *`
  line)
- the two moved-test deletions: lines 84-99 of
  `a-plan-row-names-its-ticket.test.ts` and line 21 of `plan.test.ts` — move
  only, the surrounding files stay otherwise untouched

No other branch is in flight yet — this is the first wave of this plan, and
no other plan's open slices touch these paths (checked: no other open branch
in this repo creates `packages/domain/src/rules/plan-reference.ts`).

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
