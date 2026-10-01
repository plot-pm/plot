## Implementation brief — an-open-board-follows-a-sprint-change (wave 1: A closed sprint stops filtering)

- **Plan (canonical):** `docs/plans/2026-10-01-an-open-board-follows-a-sprint-change.md` on `main`
- **Issue:** #1145
- **Approved:** 2026-10-01, jwloka, in-session
- **Branch:** `bug/a-closed-sprint-stops-filtering` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review, CI green)

One slice; nothing waits on it.

### What to build

1. **No new rule.** `AgentList` derives the effective selection once with the existing `sanitizeSelection(selected, options)` (`packages/board/src/app/lib/filters.ts:165`): `sanitizeSelection([...sprintFilter], activeSprints.map((s) => ({ value: s.slug, label: s.title })))`.
2. **Every consumer reads the derived selection.** `selectedSprints` (`AgentList.tsx:569`, today `[...sprintFilter]`) becomes the derived list, and these read it: the filtered rows (`:570`), `sprintReport` (`:579`), `workersHiddenByFilter` (`:624`) and its dependency array (`:631`), `unfilteredSectionedRows` (`:984`), `unfilteredCount` (`:1178`), the exempt mark (`:2225`), and the `selected` prop of `SprintFilter` (`:840`). **No read of `sprintFilter.size` remains.**
3. **Prune the stored `Set`** in an effect keyed on `activeSprints` when the derived selection is shorter than the `Set`. **Prune only when `activeSprints` holds at least one sprint**: an empty list (a missing or unreadable sprint directory during a checkout or fast-forward) keeps the `Set` as it is; the derived selection is empty for that poll, so the filter is off and comes back unchanged.
4. **Do not auto-select the new active sprint.**

### The sites, verified on `origin/main` 2026-10-01

| Site | Line | What is there |
|---|---|---|
| `AgentList.tsx` | 524 | `const [sprintFilter, setSprintFilter] = useState<Set<string>>(() => new Set())` |
| `AgentList.tsx` | 535 | the comment above the control's list built from `fleet.sprints` |
| `AgentList.tsx` | 569 | `const selectedSprints = useMemo(() => [...sprintFilter], [sprintFilter])` |
| `AgentList.tsx` | 570, 579, 624, 631, 840, 984, 1178, 2225 | the `sprintFilter` reads listed above |
| `lib/filters.ts` | 165 | `export function sanitizeSelection(selected, options)` |
| `lib/filters.ts` | 283 | `slugPassesSprintFilter` |
| `App.tsx` | 932-937 | the Plans tab's `validSprintSel = sanitizeSelection(sprintSel, sprintOptions)` |
| `test/unit/filters.test.ts` | 102 | `describe('sanitizeSelection', …)` |
| `test/catalogue/index.ts` | 77 | the `route` option |
| `test/integration/stubbed-tests-start-no-board.test.ts` | 621 | `const EXPECTED_TESTS = 536;` |

### Tests (from the plan)

- **Unit:** one case in the existing `describe('sanitizeSelection')` block with sprint-shaped options: two selected sprints where one closed keep the other.
- **Browser test 1**, built on the catalogue's `route` option with a mutable flag (not a second stub server). Empty-list step first: with A checked, one poll serves `sprints: []`, the next serves A again with member row `bug/a` and a row `bug/b` in no sprint; A stays checked, `bug/a` visible, `bug/b` hidden. Then the switch: the next poll carries B active with rows `bug/a` and `bug/b`, A gone; without a reload, both rows are visible, `data-sprint-hidden` is absent, no `hidden by Sprint only` text renders, B's box is unchecked. Then the flag moves back to A active with member rows `bug/a` and `bug/b`: A's box is unchecked and `bug/b` stays visible, which proves the prune.
- **Browser test 2:** A and B active, each with one member row; check both; next poll carries B only, with a row of each plus a row in no sprint; B stays checked, B's member row visible, the no-sprint row hidden.
- **`EXPECTED_TESTS` rises from 536 to 538.** If a sibling branch moves the pin first, rebase and add 2 to whatever `main` holds.

### Panel caveats a worker trips on

- **The defect hides every plan row, the closed sprint's own members included**, because the closed slug is in no membership entry. A test that only checks the new sprint's rows misses half of it.
- **The retained slug re-engages** after a branch switch to a tree where the closed sprint is still Active; the final assertion of test 1 fails on `origin/main` for that reason. Keep it.
- **The board client casts, never parses** the fleet; Zod defaults do not apply client-side. Read `fleet.sprints` defensively.
- **Browser tests load the built artifact.** Run `pnpm build:board` before them, or a stale artifact fails reassuringly.

### Done when

The sprint-shaped `sanitizeSelection` case passes; `selectedSprints` is the derived list; `AgentList.tsx` has no `sprintFilter.size`; an empty sprint list leaves the stored selection untouched (proven across a `sprints: []` poll); both browser tests pass on the built artifact and test 1 fails on `origin/main` at its first and its re-engagement assertion; `EXPECTED_TESTS` reads 538; `pnpm run test:board` and `pnpm run typecheck` pass.

### Gates

`nvm use` (Node 24), then `pnpm build:board`, `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`. **Do not run `pnpm run test:e2e`.** Board suites are flaky under load; re-run a failing file alone and compare with `main` before blaming the branch.

### Rules that bite this slice

- New functions are arrow functions.
- A `'@plot-pm/board': patch` changeset, description first; a board-only change needs no `bumps:` block.
- Rebuild `skills/plot/scripts/board/board-server.mjs` and commit it; on a conflict in it, take either side and rebuild.
- Never touch the running boards on :7777; a test starts its own board on an OS-assigned port.
- Use `trash`, never `rm`. Never `git stash`.
