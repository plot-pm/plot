## Implementation brief — one-card-grammar (wave 1: Tracer)

- **Plan (canonical):** `docs/plans/2026-11-06-one-card-grammar.md` on `main`
- **Approved:** the plan is in Design. The spike is approved: `2026-11-06, jwloka, plan-PR #3192 merged, feature/one-card-grammar-plans`. Only this branch may start. `feature/one-card-grammar-stories` and `feature/one-card-grammar-tickets` wait for `/plot-approve one-card-grammar`.
- **Branch:** `feature/one-card-grammar-plans` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per the plan's `Review: pr`. The branch is a spike: it proves the grammar on the Plans board. The review answers one question first: does every plan-card fact find a facet?

The Stories wave and the Tickets wave build on this branch's `CardFacts` schema and `<Card>`. A facet that does not fit must show up here, so the schema stays open to change until this PR merges.

### What to build

Plan cards answer a reader's questions in three different ways today, and one of them is a defect: a disabled *Start work* gives no reason, and `not measured here` and `checks not asked` render as chips with the same weight as real facts. The cause is structural. `planCardView` (`packages/domain/src/rules/plan-card.ts:58`) answers type and owner. `cardControls` (`rules/card-controls.ts:62`) answers nine independent flags. `PlanCard.tsx` (`packages/board/src/app/components/PlanCard.tsx`, 592 lines) decides the rest in the browser.

Build, in this order:

1. **`CardFacts`** in `packages/domain/src/entities/card-facts.ts` (Zod): the five facets `identity`, `lineage`, `progress`, `next`, `ownership`, exactly as the plan's `### CardFacts` Spec types them. Include the schema gate: a domain test that enumerates every string field and refuses any that is not an identifier, an ISO date or verbatim content (invariant 1).
2. **`docs/domain/card-grammar.md`**: the vocabulary. Code follows it.
3. **`planCardFacts`** in `packages/domain/src/rules/`. It extends `planCardView` and `cardControls`; it does not wrap them. `next` derives from the `cardControls` flags: pick one primary, name the reason when it is disabled.
4. **`facts` on plan cards in `/api/board`**, computed in the `board.ts` build next to the `planCardView` call (`board.ts:2676`). The projection reads only what the build already holds, so it adds no read.
5. **`card-presentation.ts`** in the board app (pure, unit-tested without a browser) and the shared **`<Card>`**, used by the Plans board in both `Board.tsx` and `Swimlanes.tsx`.
6. **`scripts/check-card-presentation.sh`**, the import gate.
7. **Retire `planCardView`** with its last caller: delete it and move `plan-card.test.ts` onto `planCardFacts`. Leave no wrapper. `cardControls` stays as `next`'s input.

The plan is canonical; this brief orients.

### Decisions the plan settles — do not re-derive them

**The domain holds facts, the UI holds words.** The test is: would a CLI listing or a Slack digest need the same value? If yes, it is a fact. `merged: 2, total: 3` is a fact; *in progress 2/3* is a word. A string field other than `title`, an id, a handle, a path or a reference is refused by the schema gate. Alternative rejected: domain-built labels. Two rules already do this (`ticketPhase.label`, `statusDrift`'s phrase), and they migrate only when their own card converts. `checks-reading.ts:216` (`label: 'checks not asked'`), `plan-spend.ts:138-144` and `slice-spend-record.ts:279` (*not measured here*) are the card words this slice must move into the mapping.

**Absent and unknown are different values.** `Known<T>` is `{ value }` or `{ unknown: reason }`, with the reason from `HostReach` minus `ok`. Absent means the board read and nothing is there. Unknown means it did not read. A throttled host must never read as *0 failing*, *unstarted* or *no PR*. This is the same rule as *the index never says no*. A fixture with a throttled host reads *checks unknown*, never zero.

**Opening is not an action.** `identity.opens` is the title link, the card's only open link. The card carries no *Open* word and no whole-card click. `next` holds only actions that change something.

**`cardControls` stays beside `next`, unchanged.** It is the plan's capability set (nine flags with no reasons), not one next action. Its schema and both callers (`board.ts:2687`, `mock-fleet.ts:498`) do not change. `mock-fleet.ts` emits facts through the same projection, never through its own shape.

**`start-work` follows `cardControls.dispatch`** (invariant 6): enabled while the plan is approved or in progress and the pulse has an eligible slice. It is primary when `readyToStart` holds, secondary otherwise. Its disabled reasons are typed, not sentences: `awaiting-fleet-scan`, `nothing-eligible` with `waitsOn` slice refs taken from the pulse's `blockedBy`, and `action-unavailable` for the board-wide refusal. `StartWorkButton.tsx:59-67` (`startRefusal`) holds today's three refusals; the server's `DispatchInfo.reason` is a free sentence and does not enter `CardFacts`.

**The presentation mapping decides no fact.** `card-presentation.ts` may import only from `@plot-pm/domain/entities/card-facts` and `packages/board/src/app/ui/`, and the gate refuses anything else. The allowance is for types: `import type` from the entity passes, and a value import of a rule is the violation the gate exists to catch. Emphasis is weight and colour, never position: `next` on the planning and delivery boards and in swimlanes. `BoardTab` (`rules/board-tab.ts:2`) is `discovery | planning | delivery`, and discovery also hosts tickets and stories, so key the emphasis on `BoardTab` plus the facts' `kind`.

**Every list of two or more collapses to a count and expands in place.** The PR list reads *6 PRs · 1 running* and expands in the card. Each expander is a `<button aria-expanded>`. A first-three preview was rejected because the reader cannot see which three; a drawer-only list was rejected because it takes the reader off the board to answer *is anything red?*.

**No meaning by colour alone.** Every alert, check state and disabled reason carries text, in both themes. The tab order is title link, primary, secondaries, expanders. The mapping's unit tests assert the text exists; one browser test asserts rows and tab order.

**The wire shape moves per kind.** This slice adds `facts` to plan cards and removes only the plan fields no reader still reads: `typeLabel` and `owner` are the two the panel found no other reader for. `Card.sprint`, `story`, `prs`, `controls` and `title` are read by `lib/filters.ts` (12 reads), `Swimlanes.tsx`, `PlanModal.tsx`, `agent-rows/menus.tsx` and `App.tsx`; they stay. Grep each before you remove it.

**Rules carried over unchanged.** Absent is not false. Read the exit code, not the emptiness. The unit is the function: you write an arrow; you leave its 60 neighbours alone. `packages/domain` takes arrow functions, factual TSDoc (what it does, parameters, return, failure; no history), and no new `Wave` where `Slice` is meant. Reasoning goes in the commit message, not in comments.

**Two gaps the plan leaves; settle each in one line and report it in the PR.** (a) `ActionKind` lists `deliver`, but `cardControls` has no deliver flag and `DeliverButton` renders only in `agent-rows/menus.tsx`. Emit no `deliver` action from `planCardFacts` in this slice; keep the button where it is. (b) `ownership.since` falls back to "the plan's file date". If that needs a new read, emit `null` and say so; the plan forbids a projection that adds a read.

### Done when

The plan's `### Done when` **Tracer** item is the specification. Lift these assertions, because a naive implementation passes without them:

- **A disabled primary carries a reason.** A unit test on `CardFacts`: `reason` is non-null exactly when `enabled` is false (invariant 3). Without it, *Start work* can stay greyed and mute.
- **No chip for absence.** A mapping test on a plan with no cost reading and an unasked check: neither `not measured here` nor `checks not asked` appears as its own chip, and each shows as an unknown in its row.
- **A throttled host never reads zero.** A fixture with `HostReach` not `ok` gives *checks unknown*, never a zero count.
- **Both render sites move.** A browser test covers the Plans board (`Board.tsx`) and a swimlane (`Swimlanes.tsx`). The slice fails if one still renders the old card.
- **Both gates fail on a seeded violation.** The schema gate refuses a free-text string field; `check-card-presentation.sh` refuses a rule import. Prove each: seed the violation, see the failure, remove it.
- **Everything the old card showed still shows:** type, rounds, spike state, verification, cost, `not-pushed` and the PR list with number, link and checks.

Plus the repo gates:

- Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e`. Do not run board tests while an operator's board is open.
- Add `scripts/check-card-presentation.sh` to `.github/workflows/ci.yml` and to the `Local checks` key in `CLAUDE.md`, then run `./scripts/check-agents-md.sh --write`. Add `test/reconcile/card-presentation-gate.test.mjs`. `test/reconcile/local-checks-coverage-gate.test.mjs` enforces the registration; run the whole reconcile glob, not only the files you suspect.
- `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice adds shell only under `scripts/`, which that gate does not count. If you touch a `.sh` file under `skills/`, pay for the growth in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines, and has no override.
- Add a changeset (description first, `bumps:` block last, package `plot` or `@plot-pm/board`). Do not commit a rebuilt `board-server.mjs` or any generated bundle: `scripts/check-no-bundle-diff.sh` refuses it. Use Node 26 (`nvm use`).

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `../plot/scripts/plot-open-pr.sh` (use `--draft` while the work moves). Never run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.

### Scope guard

This branch owns: `packages/domain/src/entities/card-facts.ts`, `packages/domain/src/rules/plan-card*.ts` and its new facts rule, `packages/domain/test/`, `docs/domain/card-grammar.md`, `packages/board/src/server/board.ts` (the plan-card build only), `packages/board/src/server/mock-fleet.ts`, `packages/board/src/contract/schema.ts` (plan `Card` only), the plan-card components under `packages/board/src/app/components/` (`PlanCard.tsx`, `Board.tsx`, `Swimlanes.tsx`), the new `card-presentation.ts` and `<Card>`, `scripts/check-card-presentation.sh`, `ci.yml`, and `CLAUDE.md`/`AGENTS.md` for the `Local checks` entry.

Out of scope: story and ticket cards (`StoriesTab.tsx`, `ticket-card.ts`, `story-card.ts`, `discovery-lanes.ts`), `statusDrift`, `POST /api/idea`, `POST /api/story-plan`, `TicketModal`, the `issue:` story field, and the Delivery tab's ticket row (`IssueRowView`, `agent-rows/rows.tsx`).

Verified at dispatch on `origin/main`: no remote branch for the Stories or Tickets slices exists, and the only other branch with a matching name, `sprint/card-alignment`, changes only plan and sprint files. A collision is not expected.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
