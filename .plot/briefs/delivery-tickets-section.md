## Implementation brief — delivery-machine-tickets-footer (wave 1: Tickets section)

- **Plan (canonical):** docs/plans/2026-11-16-delivery-machine-tickets-footer.md on main
- **Approved:** 2026-11-17, Jan Wloka, plan-PR #3469 merged
- **Branch:** `feature/delivery-tickets-section` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This is the first slice of plan 6 of 6 of the Delivery tab design. It waits on `feature/delivery-section-header`, which has merged (`dca55dce2`). Five branches wait on it: `feature/delivery-machine-line`, `feature/delivery-tab-footer`, plan 2's `feature/delivery-you-groups`, plan 1's `feature/delivery-tab-todo-list` and plan 4's `feature/delivery-fleet-plan-runs`.

### What to build

Today tickets show in three places. The reader's tickets sit in You › Input to the fleet (`ticket-assigned`, `delivery-placement.ts:202`). Other tickets sit in Work items › Queued (`workGroup`, `delivery-placement.ts:226`). Tickets that no section holds render in a block headed "Tickets and plan runs" (`AgentList.tsx:1519`), which also holds the design and verify runs. Measured on the running board on 2026-11-16: that block says "Outside the placement rule" and carries the `show every ticket` checkbox, so a reader cannot tell where a ticket lives.

This slice gives tickets one section: **Tickets**. It lists the tickets assigned to the reader that no plan names, newest first, with the columns Kind · Ticket · Do · Age, and **Plan it ›** in Do. The header reads "<n> assigned to you with no plan · <n> more unassigned · show all". The first five rows show and "… n more · show" opens the rest. **show all** opens the unassigned tickets as rows of the same form below the reader's, folded under the same "… n more" control. The count of unassigned tickets is `waiting.unassigned` (`waiting-view.ts`), not a count you derive.

Build on what exists. `waitingView` (`packages/board/src/app/lib/agent-rows/waiting-view.ts`) already computes the heading, the hidden sentence and the unassigned count. `IssueRowView` and `CreatePlanButton.tsx` already render a ticket row and its create-plan control. The plan runs and halted lines stay in a block of their own until plan 4 moves them. This slice renames that block to its runs-only content and moves the ticket rows out of it.

The plan is canonical; this brief is orientation.

### The decisions the plan settles — do not re-derive them

**Every ticket row moves in one change.** The reader's tickets leave You › Input to the fleet, and other tickets leave Work items › Queued. A ticket then shows on exactly one row at every merge. Moving only the block's tickets leaves a ticket on two rows in between, and a naive implementation passes a test that checks only the Tickets section. Assert that no ticket row renders under You or Work items. `ticket-input-to-the-fleet.browser.test.ts` changes with it, because it asserts a ticket in Input to the fleet.

**The placement rule is the domain's, and ticket placement belongs in the domain.** CLAUDE.md, "Every rendered state is a domain property": the header counts, the first-five fold, the unassigned rows, the disabled state and its reason are assertable in a unit test with no render. Extend `delivery-placement.ts` or the board's view builders (`delivery-view.ts`, `waiting-view.ts`) following the section-header slice's pattern, and write each new function as an arrow. The unit is the function: leave the neighbouring declarations alone.

**`Plan it ›` calls the existing `idea` controller.** It runs through the control ticket rows carry today (`CreatePlanButton.tsx`), with the ticket as its source. Do not add a new endpoint. On Bitbucket the controller answers `tracker-unsupported` (`packages/board/src/server/idea.ts`), and the button shows disabled with that reason. The button already marks itself busy and ignores a click while its run is in flight, and the controller refuses `already-planned` with 409 once any plan or open draft plan names the ticket. A press from a second view before the first run writes its plan is refused by neither. The plan names this as a gap, so add no lock and do not try to close it here.

**Tickets stay unscoped.** The **My sprint** toggle does not change this section (design, "The 'My sprint' Toggle"). A naive implementation threads the sprint filter through and passes a test that never turns the toggle on.

**The triage links are plans 1 and 2's.** No `triage` link exists in the code today. This slice gives them their target: the Tickets section carries a stable anchor in the same scheme as `data-delivery-group` and `scrollToAnchor`. Add no second anchor scheme and no triage link.

**The folds are keyboard buttons.** "… n more · show" and **show all** are `<button>` elements in the tab order, open and close with Enter and Space, and carry `aria-expanded`. The existing `show every ticket` checkbox is the control **show all** replaces. Remove it, and keep the host's hidden-ticket sentence only where `waitingView` still reports hidden tickets.

**Rules carried over from related work:** an absent reading is not `0`. Where `issueAnswer` is `failed`, `unsupported` or `unasked`, the section says so and shows no count of zero (the rulings of 2026-11-10 in `docs/plans/2026-11-08-every-work-item-and-agent-shows.md` stand). A ticket that a plan names stays out of the section, because the plan places it. A closed ticket stays out of it, as `ticketUnplaced` decides today. Read the placement's output and re-derive nothing.

### Done when

The plan's Done When item for this slice is the specification: every **triage** link lands on the Tickets section (this slice supplies the anchor), each ticket row offers **Plan it ›** and shows it disabled with its reason on Bitbucket, the header shows the reader's count and the unassigned count, the first five rows show and "… n more · show" folds the rest, **show all** opens the unassigned tickets as rows, no ticket row shows under You or Work items, and each fold is a keyboard button with `aria-expanded`.

Lift these assertions, because a naive implementation passes without them:

- Six tickets of the reader: five rows show and "… 1 more · show" opens the sixth. This catches a fold that shows all rows or none.
- A ticket assigned to the reader and a ticket assigned to another reader: the first shows in the section and in neither You nor Work items, and the second shows only behind **show all**. This catches a ticket on two rows.
- A ticket that a plan names shows in no Tickets row. This catches a section that lists planned tickets.
- The My sprint toggle on and off gives the same Tickets rows.
- A Bitbucket source gives a disabled **Plan it ›** with the reason `tracker-unsupported`.
- Each fold button answers Enter and Space and flips `aria-expanded`.
- One browser test proves the section shows its header, its rows and a fold opening. Unit tests prove the counts and states. `ticket-input-to-the-fleet.browser.test.ts` now asserts the ticket in Tickets and absent from Input to the fleet.

Plus the repo's gates. Commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e` locally. Run `pnpm build:board` only to look at the result in a browser, and restore any generated bundle path before you push: `scripts/check-no-bundle-diff.sh` refuses a PR that carries one. Look at the rendered tab at 320 px and in both themes. Add a changeset for the package `@plot-pm/board`, the description first and at least 20 characters, then the `plan: docs/plans/2026-11-16-delivery-machine-tickets-footer.md` line inside the comment block, with no `bumps:` entry, because this slice changes no skill. This slice touches no `.sh` file under `skills/`, so `scripts/check-shell-lines.sh` has nothing to count. If you find you need one, pay for the growth in the same change.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work still moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the Tickets section and its ticket moves: the "Tickets and plan runs" block and the `placedTickets` use in `packages/board/src/app/components/AgentList.tsx`, `packages/board/src/app/lib/agent-rows/waiting-view.ts` and `delivery-view.ts`, the ticket arms of `packages/domain/src/rules/delivery-placement.ts` (`:202`, `:226`) and `delivery-row-form.ts`, `CreatePlanButton.tsx` only where the section needs the disabled reason, and the unit and browser tests of those.

It does not touch the Machine section or the footer (`view.notPlaced`, the footer line): `feature/delivery-machine-line` and `feature/delivery-tab-footer` own them and wait on this slice, and the footer reworks the same bottom block of `AgentList.tsx`, so keep your edit to the ticket rows and the block's heading. Verified 2026-11-17 with `git ls-remote origin 'feature/delivery-*'`: only `feature/delivery-fleet-card` is pushed, and it renders the Fleet card and the `#fleet-controls` anchor. It shares no ticket code with this branch.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
