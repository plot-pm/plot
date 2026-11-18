## Implementation brief — delivery-tab-header-and-my-sprint (wave 8: Sprint scope)

- **Plan (canonical):** docs/plans/2026-11-16-delivery-tab-header-and-my-sprint.md on main
- **Approved:** 2026-11-16, Jan Wloka, plan-PR #3469 merged
- **Branch:** `feature/delivery-my-sprint-scope` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This is the last slice of the plan. It waits on `feature/delivery-release-card` (#3537), `feature/delivery-sprint-card` (#3524) and `feature/delivery-work-items-groups` (#3512). All three merged, so the slice is startable. Plan 5's `feature/delivery-sprint-delivery-scope` waits on this slice and applies the same scope rule to Release delivery, so build the rule once, as a domain function that slice can call.

### What to build

The Delivery tab has a **This sprint** chip that selects all Active sprints, and the new cards ignore it. Two cards decide their scope on their own today: `sprintCards` (`packages/domain/src/rules/sprint-card.ts:119`) always keeps only the sprints the reader owns (`sprintIsMine`), and `releaseCards` (`rules/release-card.ts`) always counts every Active sprint. This slice makes one rule decide both, from the toggle.

- **The scope rule.** A domain function takes the toggle state, the reader and the Active sprints, and answers the scope: *release* (every team member's sprints together, toggle off) or *my sprint* (the Active sprints `sprintIsMine` accepts, toggle on, combined). Its result is the one set of sprints that the status card, You and Work items read. `sprintIsMine` (`rules/sprint-ownership.ts`) is the only ownership test; write no second one.
- **The status card.** Toggle off: the release cards (`releaseCardsOf`, `delivery-readings.ts:558`). Toggle on: the sprint card (`sprintCardViewOf`). Today `AgentList.tsx` (about line 1484) mounts `FleetCard`, `SprintCard` and `TodoList` together, and `releaseCardView` feeds `TodoList` (line 1491). Keep the to-do list's "Approve release" line wherever the scope puts it; read the plan's release-card slice before you change what the list receives.
- **You and Work items.** Narrow both to the rows of plans in the scope's sprints, through the existing `rowInSprintSelection` / `slugPassesSprintFilter` path (`AgentList.tsx:767,820`, `rules/sprint-selection.ts:117`). The per-sprint chips and the `?sprint=` selection stay and narrow the scope further while the toggle is on. Fleet and Tickets stay unscoped. The Mine filter keeps its three modes and is unchanged.
- **The rename.** The chip label changes from **This sprint** to **My sprint** (`rules/chip-row.ts:117,120`, `DeliveryFilters.tsx:120`), and its `data-chip` value changes with it (`DeliveryFilters.tsx:138`). Rewrite the comment at `DeliveryFilters.tsx:63-65`, which records the opposite decision.
- **The disabled state.** The toggle is disabled with the tooltip "You own no active sprint" when the reader owns no Active sprint, which includes the case where no sprint is Active. This replaces "No sprint is Active." in `chip-row.ts:117`. The same string sits in `activeSprintButton` (`packages/board/src/app/lib/filters.ts:169`): check whether the button is still live and keep one wording.
- **The per-sprint report line.** Remove `data-sprint-report` (`DeliveryFilters.tsx:183`). The sprint card it duplicates now ships, so a sprint's timebox stays on the tab.

The plan is canonical; this brief is orientation.

### The decisions the plan settles — do not re-derive them

**The toggle is disabled, never hidden, for a reader who owns no sprint.** Jan Wloka decided it on 2026-11-16. The alternative, falling back to the release scope or to every Active sprint, hides that the toggle does nothing for this reader. A new reader with no Owner match sees a disabled control with the missing criterion (memory: no hidden UI).

**Ownership compares as a PR's ownership does.** `sprintIsMine` resolves the reader's host login and the Owner handle over `People`. A sprint with no Owner, or with a handle `People` does not declare, belongs to nobody's toggle and still counts toward the release. A reader with no host login owns no sprint. Do not compare handle strings.

**`data-chip` changes with the label.** This reverses the old decision to keep `data-chip="This sprint"` so tests keep working. The plan lists the files to update: four browser test files (`agents-tab`, `delivery-filters`, `sprint-exempt`, `sprint-switch` under `packages/board/test/integration/`) and three unit test files (`packages/board/test/unit/chip-readings.test.ts`, `packages/domain/test/chip-row.test.ts`, `packages/domain/test/filtered-estate-totals.test.ts`). Grep `This sprint` over `packages` and `test` once more before you push: a missed selector fails in CI, not locally.

**Blocked stays reader-independent.** Scope picks which sprints the bar counts; it does not change how a slice is classified. Two readers who own the same sprint get the same bar from one payload.

**Rules carried over unchanged:** absent is not false (an unread directory or reader disables the toggle with its reason, it does not enable it); every rendered state is a domain property (CLAUDE.md, "Every rendered state is a domain property"), so the scope, the disabled state and its tooltip are asserted on the fact in unit tests and the component does no arithmetic; a function you write is an arrow; icons come from `glyphs.ts` only.

### Done when

The plan's Done When item for this slice is the specification: "the toggle switches the status card, You and Work items, carries `data-chip="My sprint"`, and is disabled with the tooltip "You own no active sprint" when the reader owns no Active sprint, including when none is Active; the per-sprint report line is gone."

Lift these assertions, because a naive implementation passes without them:

- Toggle on with two Active sprints, one owned and one not, scopes the status card, You and Work items to the owned sprint only. This catches a scope that narrows the card and leaves the rows.
- Toggle off keeps the release cards over every Active sprint, owned or not. This catches a scope rule that always filters by owner, which is what `sprintCards` does today.
- A sprint with no Owner counts in the release scope and in no reader's my-sprint scope. This catches an empty handle that matches an empty login.
- A reader with no host login, and a reader whose login does not resolve to any Owner, get a disabled toggle with "You own no active sprint". Zero Active sprints gives the same reason. This catches the old "No sprint is Active." wording surviving.
- Fleet and Tickets show the same rows with the toggle on and off. This catches a scope applied to every section.
- No element with `data-sprint-report` renders, and `[data-chip="This sprint"]` matches nothing. This catches a half rename.
- One browser test proves the toggle switches the card and the rows. Run it with `pnpm --filter @plot-pm/board exec vitest related --run --project parallel <file>`, not the whole board suite, and not while the operator's board is open on this machine.

Plus the repo's gates. Commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e` locally. Run `pnpm run typecheck` and the domain typecheck that `plot-local-checks.mjs` prints. Run `pnpm build:board` only to look at the result (no horizontal scroll at 320 px, both themes), and restore any generated bundle path before you push: `scripts/check-no-bundle-diff.sh` refuses a PR that carries one. Add a changeset for the package `@plot-pm/board`, the description first and at least 20 characters, then the `plan: docs/plans/2026-11-16-delivery-tab-header-and-my-sprint.md` line inside the comment block, with no `bumps:` entry, because this slice changes no skill. This slice touches no `.sh` file under `skills/`, so `scripts/check-shell-lines.sh` has nothing to count.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work still moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the scope rule in `packages/domain/src/rules/` and its export, the `chip-row.ts` rename and disabled reason, `DeliveryFilters.tsx` (rename, comment, report line), the scope wiring in `AgentList.tsx`, and the seven test files named above. It reads `sprintIsMine`, `sprintCards`, `releaseCards` and `rowInSprintSelection`, and changes none of their rules beyond what the scope needs.

Other branches in flight: `feature/delivery-sprint-delivery-scope` (plan 5) waits on this slice and owns Release delivery's scope and the rename of its rows; do not touch `data-release-line` or the Release delivery block in `delivery-view.ts`. `feature/delivery-tab-footer` edits the footer and the not-placed block lower in `AgentList.tsx`; keep clear of them.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
