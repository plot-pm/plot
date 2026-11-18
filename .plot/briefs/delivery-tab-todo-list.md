## Implementation brief — delivery-tab-header-and-my-sprint (wave 6: To-do list)

- **Plan (canonical):** docs/plans/2026-11-16-delivery-tab-header-and-my-sprint.md on main
- **Approved:** 2026-11-16, Jan Wloka, plan-PR #3469 merged
- **Branch:** `feature/delivery-tab-todo-list` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This slice waits on `feature/delivery-section-header` (#3484), `feature/delivery-you-groups` (#3500) and `feature/delivery-tickets-section` (#3492). All three have merged, so the slice is startable. `feature/delivery-release-card` waits on this slice: it adds the "Approve release" line and removes the release row, so keep the to-do list generic over You items and let that slice add to it.

### What to build

The Delivery tab has no place that answers "am I the blocker". The reader finds out by scanning the You section row by row. This slice adds the **to-do list** to the tab header, above the cards: one line per thing the reader blocks, verb first, most urgent on top, each line marked **blocks delivery**, **input** or **clean up**. Its header counts the three markers apart: "You block 1 delivery · the fleet waits for 2 inputs · 2 to clean up". Below the list one line counts the reader's tickets with no plan and links **triage** to the Tickets section.

Build on what exists:

- The You placement already decides each item's marker. `ItemPlacement` with `section: 'you'` carries `marker` (`delivery-placement.ts:148`), set from `YOU_GROUP_MARKERS` through `youCaseOf`. The to-do list reads `placement.items` filtered to `section === 'you'`. That set already leaves out an item whose ownership is `theirs` (`delivery-placement.ts:435`).
- The verb of a line comes from `REASON_DO` (`delivery-row-form.ts:209-220`): approve, approve spike, approve release, test, review, answer, unblock, resolve, restart. Export it or its verb, capitalise it in the fact, and write no second verb table.
- The count of tickets and the **triage** target already exist in `youHeader` (`rules/you-header.ts`) and `TICKETS_ANCHOR` (`rules/tickets-section.ts:8`).
- Mount the list beside `FleetCard` and `SprintCard` in `AgentList.tsx` (about line 1471). Follow their shape: a domain function returns the whole view state and a component only renders it. Each line's name links through `itemAnchor` (`delivery-view.ts:244`), the anchor the You row already carries.

The plan is canonical; this brief is orientation.

### The decisions the plan settles — do not re-derive them

**The to-do list decides no marker.** Plan 2's table is the source, and it is already in code as `YOU_CASES` and `YOU_GROUP_MARKERS`. A naive implementation keeps its own map from reason to marker in the to-do fact, and the two drift the first time plan 2 moves a reason. Read `marker` from the placement. Assert it with a fixture whose reasons cover all three markers: `plan-approval` (blocks delivery), `draft-plan` (input) and `loose` (clean up).

**The list and the You section hold the same items.** The to-do list is read from the same `placement.items` the You section renders, so a line has a row and a row has a line. Do not rebuild the set from the payload. The release row (`release-approval`) is still under You until `feature/delivery-release-card` removes it, so it shows as a line now and that slice leaves the list unchanged.

**The three header counts add up to the number of lines.** The header and the lines come from one array in one function. A test asserts that the sum of the three counts equals the line count, so a marker that reaches the lines and not the header cannot pass.

**An absent reading is not zero.** The ticket count is `null` while the tracker has not answered (`youHeader`, `ticketAnswer`), and the **triage** line then says the count is not read. It does not print "0 tickets". `feature/delivery-you-groups` carried this rule for the You header; carry it here.

**The count of the triage line equals the count the Tickets section shows.** The line says "assigned to you". `youHeader` counts tickets whose ownership is not `theirs`, which includes `unknown` (an unassigned ticket), while the Tickets section lists `assigned` from the `mine` set (`waiting-view.ts:134`). Those two can differ. Find which one the plan means, make the line's number equal the Tickets section's "assigned to you with no plan" figure, and record the choice in the PR body. A naive implementation reuses `youHeader`'s count and prints "5 assigned to you" over a section that says 3. Assert both from one fixture with an `unknown` ticket.

**Most urgent on top is a total, deterministic order, marker first.** `blocks delivery`, then `input`, then `clean up`; the plan names no finer rule and the repo holds none. Order within a marker by a fixed reason order you declare once beside the fact, and break remaining ties by item id. Do not order by age: the You readings carry no age field this slice may rely on, and an order that moves between two polls makes the list jump under the reader. Record the reason order in the PR body. A test asserts the same input in two shuffled orders gives one line order.

**The list names no one else's work.** A line the reader does not own does not show, and the header does not count it, because `placeDelivery` already drops `theirs` items from You. The Mine filter narrows the You section; the list shows exactly what You shows, so it narrows with it. Do not add a second filter.

**Rules carried over unchanged:** absent is not false; every rendered state is a domain property (CLAUDE.md, "Every rendered state is a domain property"), so the line order, wording, counts and marker words are asserted on the fact and the component does no arithmetic; a function you write is an arrow; a marker is never colour alone, so each line carries its marker as text.

### Done when

The plan's Done When item for this slice is the specification: "the header counts blocks delivery, input and clean up apart, each line carries the marker plan 2's table gives its reason, and the triage line counts the reader's tickets with no plan and links to the Tickets section." Plus the plan's last item: every count, marker and disabled state has a unit test, and browser tests prove only what is seen.

Lift these assertions, because a naive implementation passes without them:

- Each line's marker equals `youCaseOf(reason).marker`; change a reason's group in a fixture and the line follows. This catches a second marker table.
- The three counts add up to the number of lines, and every You item has exactly one line. This catches a list built from a different set than the You section.
- A `theirs` item has no line and no count.
- The triage line's number equals the Tickets section's figure for a fixture with an `unknown` ticket, and a `null` ticket answer prints "not read", never `0`.
- The same items in two orders give one line order, marker first.
- The line's verb equals the You row's DO verb for the same reason.
- One browser test proves the list shows above the cards, that a line's name scrolls to its You row, that **triage** scrolls to the Tickets section, and that the marker word shows on every line. Run it with `pnpm --filter @plot-pm/board exec vitest related --run --project parallel <file>`, not the whole board suite, and not while the operator's board is open on this machine.
- No horizontal scroll at 320 px and both themes read (plan, *Constraints*). Check both by looking at the rendered tab after `pnpm build:board`, not by reading the diff. Icons come from `glyphs.ts` only.

Plus the repo's gates. Commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e` locally. Run `pnpm run typecheck` and the domain typecheck that `plot-local-checks.mjs` prints. Run `pnpm build:board` only to look at the result, and restore any generated bundle path before you push: `scripts/check-no-bundle-diff.sh` refuses a PR that carries one. Add a changeset for the package `@plot-pm/board`, the description first and at least 20 characters, then the `plan: docs/plans/2026-11-16-delivery-tab-header-and-my-sprint.md` line inside the comment block, with no `bumps:` entry, because this slice changes no skill. This slice touches no `.sh` file under `skills/`, so `scripts/check-shell-lines.sh` has nothing to count.

### Open points the builder settles and records in the PR body

- **Verbs with no table entry.** The design's verb list (Interrogate, Review, Approve, Release or delete) does not match `REASON_DO` one to one: `draft-plan` reads "open" and `loose` reads "plan" there, while the design says "Interrogate" and "Release or delete". Reuse `REASON_DO`, and where a design verb is clearly better for a line, change it in `REASON_DO` itself so the row and the line keep one word. Do not fork the table. Report any case you cannot settle.
- **A zero count in the header.** Decide whether a part with a count of 0 prints, and state the empty case ("You block nothing"). Assert it.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work still moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the new to-do list fact in `packages/domain/src/rules/` and its export, the to-do list component, its mount in `AgentList.tsx` beside the cards, and the unit and browser tests of those. It may export `REASON_DO` (or its verb) from `delivery-row-form.ts` and change a verb there. It reads `youHeader`, `TICKETS_ANCHOR` and the placement, and changes none of their rules.

Other branches in flight: `feature/delivery-tab-footer` (PR #3507) edits the footer and the not-placed block lower in `AgentList.tsx`; keep clear of them. `feature/delivery-release-card` waits on this slice and `feature/delivery-my-sprint-scope` waits on that one, so do not add the toggle, the release card or the release line. If you find something the plan did not anticipate, report it rather than improvising outside scope.
