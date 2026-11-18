## Implementation brief — delivery-you-blocks-or-feeds (wave 2: Loose PRs)

- **Plan (canonical):** docs/plans/2026-11-16-delivery-you-blocks-or-feeds.md on main
- **Approved:** 2026-11-16, Jan Wloka, plan-PR #3469 merged
- **Branch:** `feature/delivery-you-loose-prs` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This is the second of five slices. It waits on `feature/delivery-you-groups` (#3500), which has merged: `origin/main` holds `YOU_GROUP_MARKERS`, `youCaseOf` and `isStuckReason` in `delivery-placement.ts`. Three slices wait on this one in heading order: `-plan-rows`, `-phase-strip`, `-person-comment`. This slice and `-plan-rows` both edit `AgentList.tsx`, which is why they run one after the other.

### What to build

A closed PR whose branch still exists never reads as loose, so it never reaches Unblock. Measured by reading the code on `origin/main` on 2026-11-17: `withFixerInFlight` (`packages/board/src/server/fleet.ts:6626`) skips every PR with `pr.state === 'closed'`, so a closed PR row carries no `fixerInFlight`. The client's `looseOf` (`packages/board/src/app/lib/agent-rows/delivery-readings.ts:152`) then returns `undefined` for any row with a PR and no fixer reading, and the domain rule is never asked. The row falls to Work items › Queued, and nothing offers to delete the branch.

This slice changes three things:

1. **The client reading.** `looseOf` reads a closed PR as it reads a branch: `named` and `held`, and nothing about a fixer, because no fixer runs on a closed PR. An open PR keeps today's rule: no fixer reading, no answer.
2. **A domain fact that says "closed".** The Delete and Release buttons must be domain properties with unit tests. The domain has no fact today that separates a closed PR from a branch with no PR, so the reading carries one. The name and the type are yours, within the domain's terminology. It is a fact of the item, never of the reader.
3. **The buttons.** A closed-PR Unblock row shows **Delete** and no **Release**. A loose branch with no PR keeps both. The decision is a domain function over the item, and the component only renders its answer. The comment above `itemTail` in `AgentList.tsx` (`:1190-1192`) states today's rule ("a loose PR has neither action") and changes to the rules below.

Where the code is now. Re-read before you edit, because the line numbers drift:

- `packages/domain/src/rules/delivery-placement.ts`: the private `looseOf` (`:248`), `YouCase`, `youCaseOf`, `isStuckReason`.
- `packages/board/src/app/lib/agent-rows/delivery-readings.ts`: `looseOf` (`:152`), `hasOpenPr` (`:133`), `rowItem` (`:166`).
- `packages/board/src/app/components/AgentList.tsx`: `itemTail` (`:1190`) and the `item.rows[0]?.pr === null` test that shows the two buttons.
- `packages/domain/src/rules/loose-delete.ts`: the controller's refusals, which the button rule must follow.
- Tests: `packages/domain/test/delivery-placement.test.ts`, `packages/board/test/unit/delivery-readings.test.ts`, `packages/board/test/unit/a-loose-end-places-end-to-end.test.ts`, `packages/board/test/integration/loose-ends-show-under-unblock.browser.test.ts`.

The plan is canonical. This brief is orientation.

### The decisions the plan settles — do not re-derive them

**A button shows only where its controller would not refuse the row's own facts.** The rule is `loose-delete.ts` and `plot-dispatch.sh`, not a preference.

**Delete shows on a closed-PR Unblock row.** `looseDelete` refuses `named` and `held`, and the placement already requires both false, so those two refusals cannot fire for a placed row. It refuses `claimed` (`:112`) unless the branch holds a commit of work, its PR is `CLOSED` and the host merged no PR for it (`closedWork`, `:62-69`), and that is this row's case. It refuses `merged`, and a merged PR is delivered and never loose (`looseOf` returns `not-loose` for `delivered`).

**Release does not show on a closed-PR row.** `release-claim` runs `plot-dispatch.sh --release`, which refuses a branch whose origin carries commits that change files (`plot-dispatch.sh:1792-1803`). A branch that carried a PR carries such commits. Showing Release would offer an action that always refuses.

**An open PR shows neither button.** `looseDelete` refuses `open-pr`, and release refuses any branch with a PR. This is today's behaviour and stays.

**A loose branch with no PR keeps both buttons**, as today.

**The domain's loose rule stays.** An item is loose only where `named` and `held` are both read false (`delivery-placement.ts:248-258`). The `kind === 'pr' && fixing === undefined` arm stays too: an open PR with no fixer reading is `unread`, and a row `unread` is `unplaced`, never loose. The change is in what the client reads, so the closed-PR reading must supply what the rule asks for without inventing an answer for an open PR. A naive fix sets `fixing: false` for every PR and then places an open PR whose fixer record was never read as loose. That is the failure the arm exists to prevent.

**A closed PR on a branch a plan's slice names is not loose.** It reads `named`, the placement keeps it out of Unblock, and `loose-delete` refuses it as `named`. `a-deferred-slice-keeps-its-branch` relies on that refusal. A closed PR a desk holds, a registry manifest names or a running worker holds reads `held` and is not loose either.

**Rules carried over from related work.** An absent reading is not a false one: a closed PR whose desk listing failed leaves `held` absent and places `unplaced`, never loose. The domain decides and the component renders: each button's availability is a domain property with a unit test, and a new function you write is an arrow. The unit is the function: leave the neighbouring declarations alone. The case from `youCaseOf` does not depend on the reader, and this slice adds no ownership to it.

### Done when

The plan's Done When item for this slice is the specification: a closed PR whose branch exists, that no plan names and nothing holds shows under Unblock with Delete and without Release; a closed PR on a named slice branch, and one a desk holds, does not; each button's availability is a domain property asserted in a unit test against the controller's refusals.

Lift these assertions, because a naive implementation passes without them:

- An open PR with no fixer reading places `unplaced`, not Unblock. This catches a client that gives every PR `fixing: false`.
- A closed PR with `named: true`, and one with `held: true`, place outside Unblock. This catches a reading that drops `named` or `held` for closed PRs.
- A closed PR whose `held` is absent places `unplaced`. This catches treating an absent desk reading as false.
- The button rule is asserted per item kind: loose branch with no PR gives Delete and Release; closed PR gives Delete only; open PR gives neither. A test table over the three catches a rule keyed on `loose` alone.
- A closed PR with a merged state, or `delivered`, is never loose.
- One browser test shows a closed-PR Unblock row with the Delete button and no Release button. Unit tests prove the rule, and the browser test proves the buttons render from it.

Plus the repo's gates. Commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e` locally. Run `pnpm build:board` only to look at the result, and restore any generated bundle path before you push: `scripts/check-no-bundle-diff.sh` refuses a PR that carries one. Look at the rendered Unblock section in both themes and at 320 px. Add a changeset for the package `@plot-pm/board`, with the description first (at least 20 characters), then the `plan: docs/plans/2026-11-16-delivery-you-blocks-or-feeds.md` line inside the comment block, with no `bumps:` entry, because this slice changes no skill. The slice touches no `.sh` file under `skills/`, so `scripts/check-shell-lines.sh` has nothing to count. If you need one, pay for the growth in the same change.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work still moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the closed-PR reading in `delivery-readings.ts`, the loose rule's new fact and the button-availability function in the domain, the buttons in `AgentList.tsx` (`itemTail`) and `LooseDeleteButton.tsx` only where the rule needs it, and their unit and browser tests.

It does not own: the You groups and markers (merged), the one-row plan form, the open-question rule and the columns (`-plan-rows`), the header counts and phase strip (`-phase-strip`), or `personComment` and `PR_INDEX_VERSION` (`-person-comment`). Do not change `loose-delete.ts`, the `loose-delete` controller, `plot-dispatch.sh` or `withFixerInFlight`: the controllers' refusals are the specification here, and the fixer read stays for open PRs.

In flight: `git diff --name-only origin/main...origin/<branch>` over the pushed `feature/*` branches was not run at brief time, because the host's API budget was spent. Run it at dispatch for `AgentList.tsx`, `delivery-readings.ts` and `delivery-placement.ts` before you edit them, and expect a textual merge rather than a semantic one where a sibling touches the Machine section or the footer.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
