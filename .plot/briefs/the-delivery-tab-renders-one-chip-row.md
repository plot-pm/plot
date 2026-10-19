## Implementation brief — one-chip-row-and-a-sprint (wave 2: Board)

- **Plan (canonical):** `docs/plans/active/one-chip-row-and-a-sprint.md` on `main`
- **Approved:** 2026-10-19, Jan Wloka, plan-PR #2085 merged
- **Branch:** `feature/the-delivery-tab-renders-one-chip-row` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR (plan's `Review: pr`)

This branch waits on `feature/chip-row-states-are-domain-properties` (wave 1,
Domain) — do not start until that branch's domain rule is merged to `main`.
`/plot-fleet-scan.sh --next` will not hand this branch out until then; if you
reached this brief by another path, check `/plot-pulse` before claiming it.

### What to build

Replace the Delivery tab's two-style, two-card filter area inside
`AgentList.tsx` (NOT `App.tsx` — see below) with one row of toggle chips
(`This sprint`, `Mine (<identity>)`, `Waiting on me`) plus a sprint line that
reports only the sprint's own item states, and move the estate totals to the
right end of the chip row. The observed defect (issue #2080, read 2026-10-19):
three controls in three visual styles, taking ~200px before the first
section, where the sprint card conflates its own filter with whole-estate
totals (`485 plans · 0 open · 1 WIP · 458 done · 26 withdrawn`) that have
nothing to do with the sprint.

Every chip's label, on/off state, hidden count, and disabled reason is a
domain property the wave-1 branch computes and unit-tests — this slice only
renders what that rule returns. Per `CLAUDE.md`'s *Every rendered state is a
domain property*: if you find yourself computing a hidden-count or a
disabled-reason string in the `.tsx`, that computation belongs in the domain
rule instead, and its absence here is a gap in wave 1, not something to patch
locally.

### The decisions the plan settles — do not re-derive them

**The actual render site is `AgentList.tsx`, not `App.tsx`.** The plan's
"Existing code" list names `packages/board/src/app/App.tsx` for "the
`data-mine-filter` checkbox" — that line is imprecise. Verified by reading
both files: `App.tsx:1218` does have a `data-mine-filter` checkbox, but it is
gated on `tab === 'planning' || tab === 'discovery'` and never renders on
Delivery at all. The Delivery tab's actual `SprintFilter` instance and its
own, separate `data-mine-filter` control both live inside
`AgentList.tsx` (`SprintFilter` render ~line 938; the mine-filter `<label>`
~line 987). That second block is what this slice replaces. Leave `App.tsx`'s
Planning/Discovery checkbox alone — the plan's Open Questions ask whether
those tabs get the same chip row, and the answer there is "not yet, the issue
covers Delivery only," so touching that checkbox is out of scope here.

**`#2079` (identity-says-no-identity) is already Delivered** —
`docs/plans/delivered/only-my-work-says-no-identity.md`, delivered
2026-10-19. The plan text says "this plan consumes that fix and does not
repeat it"; that fix is merged to `main` already, so there is nothing to wait
on there. `readerIsKnown` / `boardAnswered` gating already exists in
`AgentList.tsx` around the current mine-filter block — read it before
reinventing the "board hasn't answered yet" vs. "board named nobody" split,
because the chip's disabled-reason text for `Mine` needs exactly that
distinction and wave 1's domain rule should already carry it.

**`mine-filter.ts`'s persistence and filtering functions are unchanged.**
`readMineOnly`/`writeMineOnly` (localStorage, key `plot-board:agents:mine-only`,
default OFF) and `rowsForReader`/`agentsForReader`/`ticketsForReader`/
`boardForReader` stay exactly as they are — this slice only changes how the
toggle and its state are *rendered* (as a chip instead of a labeled
checkbox), never how the preference is stored or how rows are filtered. Do
not touch `mine-filter.ts`.

**`SprintFilter.tsx`'s whole public shape goes away.** Its current props
(`sprints`, `selected`, `onToggle`, `estateTotals`, `report`, `selectAll`,
`onSelectAll`) and its `Active sprint` button, its disabled-with-no-sprint
branch, and its per-sprint "Sprint only" checkbox rows are all replaced by
the chip row + sprint line. This is a rewrite of the component, not an
incremental edit — expect the file to look structurally different afterward.
Decide while rewriting whether `SprintFilter.tsx` keeps its name or becomes
something like `ChipRow.tsx` / `DeliveryFilters.tsx`; the plan does not settle
this, and no other branch references the file by name outside `AgentList.tsx`
(one import, trivial to update either way).

**Estate totals drop `open` and `withdrawn` per the issue's own example** —
the plan's Open Questions flags this as unresolved (`Where does the estate
total's 0 open and 26 withdrawn go`). The target layout in the plan's Design
section shows `485 plans · 1 WIP · 458 done` — two buckets missing from the
current four-bucket `formatCounts`. If wave 1's domain rule for "filtered
estate totals" already picked a shape, render exactly that; if it still
carries all four buckets, that is a question to raise rather than resolve by
guessing — the plan explicitly left it open.

**375px wrap is a hard requirement, not a nice-to-have.** The current mine-
filter block already carries a comment recording a real incident: a
`shrink-0` chip put 26px of horizontal overflow on the document at 375px,
scrolling the whole board sideways. The browser test for this slice must
check 375px explicitly, not just desktop width.

### Done when

The plan's `## Done when` is implicit in its Design section (no explicit
`## Done when` heading exists in this plan — treat the Design section's
bullets as the spec): one chip row replaces the three controls/two cards; an
active chip is filled and states its hidden count; a disabled chip shows a
tooltip naming the fix; the sprint line reports only the sprint's items and
links the sprint name; estate totals sit at the right end of the chip row;
the row wraps at 375px without horizontal scroll.

Write a unit test only if you end up computing anything in the `.tsx` that
should have been a domain property (and then move it, rather than testing it
in place). The slice's own spec calls for one browser test showing the row at
desktop width and at 375px — assert on `data-*` attributes the same way the
current `data-mine-filter`/`data-mine-known`/`data-mine-hidden`/
`data-sprint-report` attributes work, so the test can read rendered state
without snapshotting styles.

Plus: a changeset bumping `@plot-pm/board` (this plan's Board impact note
says the artifact needs `pnpm build:board`, done automatically by CI/merge —
never commit the rebuilt bundle yourself). `scripts/check-shell-lines.sh`
does not apply here (no `.sh` touched). Run
`node skills/plot/scripts/board/plot-local-checks.mjs` before each push and
run what it prints; the `CI suites` config key's suites run in CI, and a
failure there comes back as a correction — do not run the full e2e suite
locally.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR through the
controller once ready:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch, ready for review
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Do not run `gh pr create` directly. Once the PR exists, append
`→ #<number>` to this branch's line in the plan's `## Slices` section (the
`feature/the-delivery-tab-renders-one-chip-row` line under `### Board`).

### Scope guard

This branch owns: `packages/board/src/app/components/SprintFilter.tsx` (or
its renamed form) and the chip-row/mine-filter/sprint-line render block
inside `packages/board/src/app/components/AgentList.tsx`. It does not touch
`packages/domain/src/rules/lanes-for-reader.ts` or any other domain rule file
— those are wave 1's territory and should already be merged by the time this
branch starts. It does not touch `App.tsx`'s own `data-mine-filter` checkbox
(Planning/Discovery tabs) or `mine-filter.ts`'s exported functions.

If wave 1 merged a domain rule whose shape doesn't match what this brief
assumed (e.g. different field names for the chip properties, or a totals
shape that still carries all four buckets), that is expected drift between
when this brief was written and when wave 1 actually lands — read wave 1's
merged code directly rather than trusting this brief's guesses about its
exact API.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
