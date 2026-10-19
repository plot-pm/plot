## Implementation brief — one-chip-row-and-a-sprint (wave 1: Domain)

- **Plan (canonical):** [docs/plans/2026-10-19-one-chip-row-and-a-sprint.md](../../docs/plans/2026-10-19-one-chip-row-and-a-sprint.md) on `main`
- **Approved:** 2026-10-19, Jan Wloka, plan-PR #2085 merged
- **Branch:** `feature/chip-row-states-are-domain-properties` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per plan (`Review: pr`)

This is wave 1 of 2. `feature/the-delivery-tab-renders-one-chip-row` (wave 2) waits on this branch and renders the properties this branch returns. This branch touches `packages/domain` only.

### What to build

Issue #2080 records the Delivery tab on 2026-10-19: three controls in three styles, two cards, about 200 px of height, and totals (`485 plans · 0 open · 1 WIP · 458 done · 26 withdrawn`) that count the whole estate while a sprint filter is on. Wave 2 replaces that with one row of toggle chips and a sprint line. This wave writes the rules that decide what the row says, so the `.tsx` decides nothing (root `CLAUDE.md`, *Every rendered state is a domain property*).

Three rules, in `packages/domain/src/rules/`, exported from `packages/domain/src/index.ts` next to `lanes-for-reader.js`:

1. **`chipRow`** — per chip (`This sprint`, `Mine (<identity>)`, `Waiting on me`): label, on/off, hidden count, and a disabled reason that names the fix (`null` when the chip can act). `Mine` carries the identity in its label; with no identity the chip is disabled and the reason names what to configure.
2. **The sprint line's own item states** — the sprint's items by state (`6 done · 2 WIP · 1 open`), counted from the sprint's items only, never the estate.
3. **The filtered estate totals** — the totals count what the active filters leave in view.

Build on what exists. `lanes-for-reader.ts` (`filterByReader`, `hiddenByOwner`) already answers the `Mine` filter, and `ownership.ts` owns `Reader`, `isMine` and the identity fields. `filters.ts` in the board holds `activeSprintButton` and the sprint bucket derivation (open/WIP/done/withdrawn); the sprint-line and totals rules reuse that bucket derivation so a total still equals the sum of its buckets. Do not edit `packages/board` in this wave.

### Settled decisions — do not re-derive them

- **A chip that cannot act is disabled and says why.** The plan rules out inline prose; the tooltip is the only place the fix is named. A chip that filters nothing it can name must be disabled, never silently inert.
- **`Mine` names the identity it matches.** The identity text comes from `Reader`; wave 2 never composes it.
- **Hidden counts come from a rule, not from the component.** `hiddenByOwner` is a lane-level boolean today; a count needs a new property here.
- **Layering:** the domain imports `zod` and nothing else outside `adapters/`, and every new function is an arrow (`export const f = (…) => …`). TSDoc states what an export does, takes and returns — no history of the decision.
- **`only-my-work-says-no-identity` is in flight.** Its fix changes the state the missing-identity tooltip reads. Write the disabled reason against `Reader` as it stands today (`hostUser`/`gitEmail` empty or absent), and do not duplicate that plan's `known` property: if it has merged by the time this branch is rebased, consume it.

### Open questions the plan leaves unanswered

The plan lists five. Wave 1 depends on three; none is the implementer's to guess.

1. **Rows or plans for `N hidden`?** Decide which unit the hidden count uses and make the rule's input shape say so. State the choice in the TSDoc and in the PR description.
2. **What does `Waiting on me` filter?** The plan names the chip and no behaviour. If no behaviour can be named from the existing code, the rule returns the chip disabled with a reason, as the plan requires.
3. **Which totals survive?** The issue's example drops `0 open` and `26 withdrawn`. Keep all four buckets in the rule's return value and let wave 2 choose what to print: a rule that drops a bucket cannot be undone from the `.tsx`.

The sprint-link target and the Discovery and Planning tabs belong to wave 2. If a decision needs a person, record it as `PLOT-UNASKED: <question> — <default taken>` in the PR description and take the reversible default. Do not stop the wave for it.

### Done when

The plan's slice line is the specification: one rule returning, per chip, label, on/off state, hidden count and disabled reason with the fix it names; a rule for the sprint line's own item states; a rule for the filtered estate totals; unit tests assert each.

Assertions that exist because a naive implementation passes without them:

- **Filtered totals differ from estate totals when a filter is on.** A fixture where `This sprint` hides rows must assert the totals shrink; a rule that returns the estate counts passes every other test.
- **The sprint line ignores the estate.** A fixture with sprint items and many non-sprint plans asserts the line counts the items only.
- **Bucket arithmetic holds under filtering.** Total equals open + WIP + done + withdrawn for every filter combination.
- **A disabled chip never reports a hidden count above zero.** Catches a rule that counts rows for a chip that cannot act.
- **`Mine` with an empty identity is disabled; with only `gitEmail` set it is enabled.** Catches the inverse of the #2079 defect.
- **Mutation-check the fixtures:** each arm of a rule needs a fixture where the arms disagree, or the test proves nothing.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction; list no full suite. Add a changeset (description first, `bumps:` block last); `./scripts/check-changeset-packages.sh` checks it. This wave changes no `.sh` file, so `scripts/check-shell-lines.sh` does not apply.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

Owned by this branch: `packages/domain/src/rules/` (new chip-row, sprint-line and totals rules), `packages/domain/src/index.ts` (exports), `packages/domain/test/` (their tests), and the changeset.

In flight beside it: `feature/the-delivery-tab-renders-one-chip-row` (wave 2, blocked on this branch) owns `SprintFilter.tsx`, `App.tsx` and `mine-filter.ts`. `bug/only-my-work-says-no-identity` owns the identity fix in `mine-filter.ts` and `AgentList.tsx`. Do not edit those files here.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
