## Implementation brief — tickets-for-the-release-and-loose (wave: Tickets on the board)

- **Plan (canonical):** docs/plans/2026-11-08-tickets-for-the-release-and-loose.md on main
- **Design (canonical):** docs/superpowers/specs/2026-11-08-delivery-tab-design.md, approved 2026-11-08 — read "Who Is Me" and "Tickets and loose ends"
- **Approved:** 2026-11-08, Jan Wloka, plan-PR #3250 merged
- **Branch:** `feature/tickets-reach-input-to-the-fleet` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review gate on main)

This branch is the first of three in wave "Tickets on the board". Its siblings `feature/sprint-work-records-the-ticket-it-opened` and `feature/the-release-line-counts-tickets` wait on the same merged branch, `feature/delivery-tab-sections` (#3267, merged to `main`). All three may run at once. `feature/loose-ends-show-under-unblock` is a different wave and owns the loose-end controllers.

### What to build

Today the Delivery tab places no ticket. `placeDelivery` (`packages/domain/src/rules/delivery-placement.ts`) takes `WorkItemReading` values of kind `plan | slice | pr | branch | release`, and `ItemKind` has no `ticket`. The design's seventh You case, "a ticket assigned to me that has no plan", is therefore unbuilt, and the placement brief of plan 1 left it to this plan on purpose.

Add the ticket case to the rule, and feed it from the two readings that wave "Identity and reads" shipped:

- A ticket assigned to the reader that no plan answers places under **You › Input to the fleet**. Add a `ticket` item kind and a ticket reason to `YouReason`, in the rule, with a unit test per case.
- The **Sprint** filter narrows that list to the tickets planned for the sprint's target release. `releaseOf(row, version)` (`packages/domain/src/rules/release-of.ts`) answers "planned for". The target release is the `Release:` field of the active sprint (`docs/sprints/2026-W45-ship-2-32-0.md` carries `2.32.0`). Where two active sprints name one `Release:`, both feed it. Where the filter is off, the list shows every ticket assigned to the reader.
- A ticket that a plan names shows through that plan only. The existing `waitingTickets` rule (`packages/domain/src/rules/waiting-tickets.ts`) already separates unplanned from planned rows through its `plans` map keyed by the row's `number`. Reuse that join. Do not write a second one.
- The board maps the issue index rows to the rule's readings in `packages/board/src/app/lib/agent-rows/delivery-readings.ts`, and the tab renders the result. The mapper decides nothing: ownership comes from `ownedFrom…`/`ticketOwnership`, the section from the rule.

Lead with the failure it fixes: a ticket assigned to the reader appears nowhere on the Delivery tab, and no row says which tickets are planned for 2.32.0. The tickets exist in `issues.json` since #3256 and nothing reads them for placement.

The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

**The board makes no second read.** Assignee and release come from `issues.json` rows (`assignees`, `releases`), which `refreshIssueIndex` writes through the tracker connector. A call to `plot-host.sh issue-list` from the board or from this rule is the exact duplicate that the plan's Non-goals refuse.

**A ticket is planned for a release by exact name.** `releaseOf` compares the version as a name: `2.32` does not match `2.32.0`. A GitHub issue carries one milestone and a Jira issue may carry several fix versions, and `releaseOf` handles both because the host script emits one `releases` array. Do not add a milestone-specific or fix-version-specific branch.

**Absent is not false.** `releaseOf` answers `false` for a row with no `releases` and for `releases: []`, and it says so. That is right for a filter that narrows, and wrong for a count. This slice narrows, so `false` is correct. A row that was never asked for its releases must not be silently counted as "not planned" anywhere a number shows. If the rule needs the difference, read `row.releases` itself. The release-line slice owns the counts, so do not build counts here.

**Index version.** `ISSUE_INDEX_VERSION` is 2 and a reader of version 1 answers *ask again*, never an empty list. A board with a version-1 `issues.json` shows "the fleet has left no issue index to read" and not an empty inbox. Test this seam by name: an old-version store places no ticket and says why.

**The Mine filter's three modes apply.** The rule takes the mode as an input value (`DeliveryMine`: `off | mine | strict`) because the filter lives in the board app. Do not import it into the domain. A ticket whose assignee does not resolve to the reader reads `unknown` under `ticketOwnership`, and `unknown` stays visible under `mine` and hides under `strict`, as for every other row.

**Who the reader is on a tracker.** A Jira assignee resolves only through a declared `<tracker:account>` spelling in `People`. `trackerAccountsOf` (`packages/domain/src/entities/person.ts`, #3254) answers which accounts a handle holds on one tracker. Use it. Do not parse `People` again.

**Terminology is binding** (CLAUDE.md, "The Domain Package"). Write `Slice`, never `Wave`, where a slice is meant. An **Agent** is the actor and `Worker` stays machine-side. New functions are arrows: `export const f = (…) => …`. Doc comments say what an export does and how it fails, with no history.

**Every rendered state is a domain property.** If a row's group, its wording or its disabled state could be computed in `.tsx`, it belongs in the rule. The browser test proves only that the row shows.

### Done when

The plan's `Done when` list does not exist. The specification is the design's "Tickets and loose ends" first bullet and the settled decisions above. These assertions exist because a naive implementation passes without them:

- **A planned ticket is absent from Input to the fleet.** One fixture holds a ticket that a plan names and one that no plan names, both assigned to the reader. Only the second places there. A test of the unplanned ticket alone passes while the planned one double-places.
- **Once-ness.** Extend the existing mixed-estate placement test so that every ticket appears exactly once across all sections.
- **The Sprint filter narrows, and off widens.** The same two tickets, one with `releases: ['2.32.0']` and one with `releases: ['2.31.0']`. With the filter on for a sprint whose `Release:` is `2.32.0`, one shows. With it off, both show. This proves both directions.
- **`2.32` does not narrow to `2.32.0`.** A ticket with `releases: ['2.32']` is absent under target `2.32.0`.
- **A ticket with no `releases` field is not read as "not planned".** It stays in the list with the filter off, and under the filter the rule names the absent reading instead of dropping the row without a trace.
- **A ticket assigned to someone else** places under Work items with that person in BY, or is hidden by the Mine mode as every other row of theirs is. It never reaches You for this reader.
- **A closed ticket** does not place. `issues.json` carries closed rows for 14 days (`ISSUE_INDEX_CLOSED_DAYS`), and a naive mapper lists them.
- **Old-version store** — see "Index version" above.

Plus: the board artifact is generated output. Do not commit `skills/plot/scripts/board/board-server.mjs` (`scripts/check-no-bundle-diff.sh` refuses a bundle in a PR diff, and `main` builds its own). Run `pnpm build:board` only to test locally, then restore the generated paths before you push. Add a changeset for `plot` with the description FIRST and the `bumps:` block LAST, with a `plan:` line inside the block (`./scripts/check-changeset-packages.sh` refuses the other order).

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run no full suite. `test:e2e` is CI's gate, not a local one.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file. If it does, remove an equal number of lines elsewhere in the same change, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines, and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). Do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/domain/src/rules/delivery-placement.ts` and its test (`packages/domain/test/delivery-placement.test.ts`), the ticket mapping in `packages/board/src/app/lib/agent-rows/delivery-readings.ts`, the rendering of a ticket row in the You › Input to the fleet group, and one browser test that shows the row.

Do not touch:

- `packages/domain/src/entities/person.ts` and `packages/domain/src/rules/release-of.ts` — they are shipped (#3254, #3256). Call them.
- The release-line counts (`feature/the-release-line-counts-tickets`).
- The "opened by sprint" record and its mark (`feature/sprint-work-records-the-ticket-it-opened`). It writes a line under the sprint's Notes. This branch reads none of it.
- Loose PRs and branches, and the release and delete controllers (`feature/loose-ends-show-under-unblock`).
- Row forms and the seven columns (plan 2, `rows-share-seven-columns-and-link`). The ticket row uses whatever the shipped row form gives. Where the form has no ticket variant, report it instead of widening the form.

The two siblings in this wave edit `delivery-readings.ts` and `delivery-view.ts` too. Keep the ticket mapping in its own function so a merge conflict is a different hunk. Verified at dispatch: no remote branch of the four siblings exists yet.

If you find something the plan did not anticipate, report it rather than improvising outside scope. Where a gate or a rule forces a choice between two readings, write a `PLOT-BLOCKED` marker that names the conflict and stop.
