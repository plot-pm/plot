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

Build on what exists. `lanes-for-reader.ts` (`filterByReader`, `hiddenByOwner`) already answers a Discovery-side ownership filter and is the shape to mirror, not reuse directly — the Delivery tab's `Only my work` has its own pure functions in `packages/board/src/app/lib/agent-rows/mine-filter.ts` (`rowsForReader`, `agentsForReader`, `ticketsForReader`), which is the control this plan's chip row actually replaces. `ownership.ts` owns `Reader`, `isMine` and the identity fields. `filters.ts` in the board holds `activeSprintButton` and `SprintFilter.tsx`'s `formatCounts` holds the open/WIP/done/withdrawn bucket derivation; the sprint-line and totals rules reuse that bucket shape so a total still equals the sum of its buckets. Do not edit `packages/board` in this wave.

### Settled decisions — do not re-derive them

- **A chip that cannot act is disabled and says why.** The plan rules out inline prose; the tooltip is the only place the fix is named. A chip that filters nothing it can name must be disabled, never silently inert.
- **`Mine` names the identity it matches.** The identity text comes from `Reader`; wave 2 never composes it.
- **Hidden counts come from a rule, not from the component.** `AgentList.tsx:977` computes `hidden` as a JSX-local `filteredRows.length - visibleRows.length` today; a rule needs this as a returned property, not a second inline computation beside it.
- **Hidden counts are rows, not plans.** The existing controls both already chose this unit: `AgentList.tsx:977`'s `Only my work` hidden count and `SprintFilter`'s `report.hidden` (`AgentList.tsx`, built over the same row list) both count rows. The plan's own Open Question ("rows or plans?") is answered by this precedent unless you find a contradicting signal — state the choice in the TSDoc and close the question in the PR rather than leaving it open a second time.
- **Layering:** the domain imports `zod` and nothing else outside `adapters/`, and every new function is an arrow (`export const f = (…) => …`). TSDoc states what an export does, takes and returns — no history of the decision.
- **`only-my-work-says-no-identity` is in flight and has NOT merged.** Checked at brief-writing: `AgentList.tsx:976` still computes `known` inline as `(reader.hostUser ?? '') !== '' || (reader.gitEmail ?? '') !== ''`, and that bug plan's own hand-off brief (`.plot/briefs/only-my-work-says-no-identity.md`) has only just been written — no branch or commit exists yet. Write the `Mine` chip's disabled reason against the same boundary condition (`known` as defined above) rather than waiting for that plan; this branch carries no `waits:` on it. Check again immediately before you start work — `git log` on `mine-filter.ts`/`AgentList.tsx` or whether `known` is still inline there — and if it has landed by then, consume its extracted property instead of re-deriving the same boundary a second time.
- **The plan's own branch-list bullet naming `App.tsx`'s `data-mine-filter` checkbox is not the control this plan means.** `App.tsx:1187-1198` has its own, unrelated `data-mine-filter` label gated on `tab === 'planning' || tab === 'discovery'` — it never renders on Delivery. The Delivery tab's `Only my work` control the plan's mockup actually targets is the separate `data-mine-filter` instance at `AgentList.tsx:973-1014`. This affects wave 2's scope, not this wave's — but it means wave 2's brief should not point at `App.tsx` for this control. Flag it in your PR rather than silently acting on the plan's mis-citation; nothing in `App.tsx` is this plan's to change (it's also one of the plan's own Open Questions — "Do the Discovery and Planning tabs get the same chip row?" — unresolved either way).

### Waiting on me has no filtering behaviour to read yet

Today "waiting" is a *section* (`AgentList.tsx`'s `Waiting on you` block, backed by `packages/domain/src/rules/waiting-tickets.ts` / `waiting.ts`), not a filter over the other Delivery sections. Build `chipRow` so a disabled `Waiting on me` chip — hidden count 0, reason naming that no filtering behaviour is defined — is a legitimate, tested output, not a workaround. Do not guess a behaviour to make the chip enabled; that decision belongs to whoever answers the plan's own open question, and guessing now hands wave 2 a rule shape it has to change.

### Open questions the plan leaves unanswered

The plan lists five. Wave 1 depends on two; neither is the implementer's to guess:

1. **What does `Waiting on me` filter?** Covered above — the rule returns the chip disabled, as the plan requires when a chip can name no behaviour.
2. **Which totals survive?** The issue's example drops `0 open` and `26 withdrawn`. Keep all four buckets in the rule's return value and let wave 2 choose what to print: a rule that drops a bucket cannot be undone from the `.tsx`.

The sprint-link target and the Discovery/Planning tab question belong to wave 2 or later. If a decision needs a person, record it as `PLOT-UNASKED: <question> — <default taken>` in the PR description and take the reversible default. Do not stop the wave for it.

### Done when

The plan's slice line is the specification: one rule returning, per chip, label, on/off state, hidden count and disabled reason with the fix it names; a rule for the sprint line's own item states; a rule for the filtered estate totals; unit tests assert each. No `.tsx` file changes in this PR.

Assertions that exist because a naive implementation passes without them:

- **Filtered totals differ from estate totals when a filter is on.** A fixture where `This sprint` hides rows must assert the totals shrink; a rule that returns the estate counts passes every other test.
- **The sprint line ignores the estate.** A fixture with sprint items and many non-sprint plans asserts the line counts the items only.
- **Bucket arithmetic holds under filtering.** Total equals open + WIP + done + withdrawn for every filter combination.
- **A disabled chip never reports a hidden count above zero.** Catches a rule that counts rows for a chip that cannot act.
- **`Mine` with an empty identity is disabled; with only `gitEmail` set it is enabled.** Catches the inverse of the #2079 defect.
- **`Waiting on me` is disabled with no behaviour wired.** Catches a rule that silently enables a chip with nothing to filter.
- **Mutation-check the fixtures:** each arm of a rule needs a fixture where the arms disagree, or the test proves nothing.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction; list no full suite. Add a changeset (description first, `bumps:` block last); `./scripts/check-changeset-packages.sh` checks it. This wave changes no `.sh` file, so `scripts/check-shell-lines.sh` does not apply.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

Owned by this branch: `packages/domain/src/rules/` (new chip-row, sprint-line and totals rules), `packages/domain/src/index.ts` (exports), `packages/domain/test/` (their tests), and the changeset.

In flight beside it: `feature/the-delivery-tab-renders-one-chip-row` (wave 2, blocked on this branch) owns `SprintFilter.tsx` and `AgentList.tsx`'s render block. `bug/only-my-work-says-no-identity` owns the identity fix in `mine-filter.ts` and `AgentList.tsx` — not yet started (no branch exists). Verified at brief-writing: no local or remote branch exists for either wave 2 or the identity bug, so there is no live collision to track today.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
