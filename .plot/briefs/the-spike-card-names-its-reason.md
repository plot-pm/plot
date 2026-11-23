## Implementation brief — board-readings-take-the-domain-answer (wave 3: Spike card)

- **Plan (canonical):** docs/plans/2026-11-21-board-readings-take-the-domain-answer.md on main
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3613 merged
- **Branch:** `bug/the-spike-card-names-its-reason` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review, per the plan's `Review: pr`

The slices before this one (`bug/an-approval-with-no-pr-writes-no-pr-key`, `bug/a-delivery-row-carries-its-plan-state`) touch other files and build nothing this slice reads. The slices after it (`the-plan-store-corpus-checks-both-lists`, `the-verdict-line-drops-the-spike-columns`, `plot-implement-asks-for-the-spike`) do not wait on it either.

### What to build

A Design plan whose `Spike approved:` record licenses no branch shows one card line, `spike not approved yet`, for five different faults: no record, a record with no branch, an unparseable record, a spike marker that moved, and a branch no slice names. `licensedSpike` (`packages/domain/src/rules/spike.ts:95`) already tells the five apart with a `SpikeUnlicensed` reason, and `spikeCardState` (`packages/domain/src/rules/spike-confirm.ts`) drops that reason at its `spike-not-approved` return. The slice carries the reason from `licensedSpike` to the card and to the pulse, and `/plot-pulse` names it. The plan (Approach, slice 3) is canonical; this brief orients you.

Build order that keeps each step green:

1. `spikeCardState` answers `{ state: SpikeCardState; reason: SpikeUnlicensed | null } | null`. `reason` is `licensedSpike`'s reason on `spike-not-approved` and `null` otherwise. Update every caller.
2. `CardControls` (`packages/domain/src/rules/card-controls.ts`) gains `spikeUnlicensed` next to `spikeState`.
3. `CardFacts.progress.design` (`packages/domain/src/entities/card-facts.ts`) gains `spikeUnlicensed: SpikeUnlicensedSchema.nullable()`. Add `SpikeUnlicensedSchema` beside `SpikeCardStateSchema`, give it its own `// plot-state: reading — …` declaration (copy the form used for `spikeState`; `scripts/check-state-declarations.sh` refuses a state without one), and add a `same<…, SpikeUnlicensed>` check. `plan-card-facts.ts` copies the field from the controls.
4. `card-presentation.ts` (`packages/board/src/app/lib/`) words each reason, each followed by `— use Approve spike` except the first:
   - `spike-record-absent` → `spike not approved yet` (unchanged, no pointer)
   - `spike-record-branchless` → `spike record names no branch`
   - `spike-record-unparseable` → `spike record does not parse`
   - `spike-marker-moved` → `spike approved for a branch the spike marker no longer marks`
   - `spike-branch-renamed` → `spike approved for a branch no slice names`
5. The pulse `PlanSchema` (`packages/domain/src/entities/fleet.ts`) gains `spikeUnlicensed: SpikeUnlicensedSchema.nullable().default(null)`. The plan walk (`packages/domain/src/workflows/plan-walk-assembly.ts`) fills it for a Design plan with one spike whose record licenses nothing.
6. `skills/plot-pulse/SKILL.md` names the reason and `plot-approve-command.mjs --spike --who <handle> <slug>` on that plan's `unapproved` line. Update its Model Guidance table if a step changes. `skills/plot-pulse/README.md` stays in sync.

### Decisions the plan settles — do not re-derive them

**The carrier is `CardFacts`, not `CardControls` alone.** `card-presentation.ts` reads only `CardFacts`; `scripts/check-card-presentation.sh` allows `@plot-pm/domain/entities/card-facts` and UI helpers only. A reason that lives only on `CardControls` cannot reach the wording without breaking that gate.

**`spike-none` is unreachable here.** `spikeCardState` answers `null` before `licensedSpike` runs when the plan has no single spike (`spikeOf(slices) === undefined`), so the card needs five wordings, not six. Do not add a wording for `spike-none`.

**The card prints no command.** The card points at its existing *Approve spike* button. The gated bundle `plot-approve.mjs` appears nowhere in the new text. The board-free command is `plot-approve-command.mjs --spike --who <handle> <slug>` (`entry/approve-command.ts`), and only the pulse line names it, because the pulse is read in a terminal. Naming `plot-approve.mjs` fails because the controller gate refuses it with no receipt.

**The reason is a domain property, so no browser test.** Each wording is asserted in a unit test over `CardFacts`. A browser test would start a board server to see a string a unit test reads for free.

**Rules carried over, unchanged.** Absent is not false: `spikeUnlicensed` is `null` for a licensed plan, a non-Design plan and a plan with no single spike, and a consumer reads `null` as "no reason to show", never as "licensed". Arrow functions for every function you write. A TSDoc block states what an export returns and how it fails, not the history of the decision; the reasoning goes in the commit message.

### Done when

The plan's `## Slices` line for this branch and its Approach for slice 3 are the specification. The assertions a naive implementation would pass without:

- `packages/domain/test/spike-confirm.test.ts` updates its 7 calls to the new shape and adds one cell per reachable reason (five), one licensed record with `reason: null`, and one plan with no single spike answering `null`. Without the five cells, a card that maps every reason to one string passes.
- `packages/board/test/unit/licensed-spike-agreement.test.ts` reads `.state` and also asserts the card's reason equals `licensedSpike`'s reason on the same input. It catches a card that re-derives the reason itself.
- `packages/domain/test/plan-card-facts.test.ts` gains a cell that `spike-branch-renamed` reaches `design.spikeUnlicensed`. It catches a field the controls carry and the facts drop.
- `packages/board/test/unit/card-presentation.test.ts` gains a cell per reason for the line above and keeps `spike not approved yet` (near `:129`) for `spike-record-absent`. It catches a pointer added to the unchanged line.
- A plan-walk test asserts `spikeUnlicensed` on the pulse plan for `spike-marker-moved` and `null` for a licensed record.

Plus: write a changeset with the description first and the `bumps:` block last, bumping `plot-pulse` (`./scripts/check-changeset-packages.sh` checks it); add `plan: docs/plans/2026-11-21-board-readings-take-the-domain-answer.md` inside the block. Run `pnpm build:board` locally to test the board, and commit no bundle (`scripts/check-no-bundle-diff.sh` refuses one). For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run no full suite and no `test:e2e`. If the slice touches a `.sh` file, `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base: pay for growth in the same change, by removing shell elsewhere or by writing the rule in the domain and asking it through a bundle. The gate counts commands, not lines, stores no number and has no override. This slice should add no shell.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves) and never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.

### Scope guard

This branch owns: `packages/domain/src/rules/spike-confirm.ts`, `rules/card-controls.ts`, `rules/plan-card-facts.ts`, `entities/card-facts.ts`, `entities/fleet.ts`, `workflows/plan-walk-assembly.ts`, `packages/board/src/app/lib/card-presentation.ts`, `skills/plot-pulse/`, their named tests, and one changeset.

Out of scope, owned by other slices of this plan: `packages/board/src/server/entry/verdicts.ts` and `plot-verdicts.mjs` (slice 5), `plan-store.corpus.test.ts` (slice 4), `plot-ask.mjs` and `skills/plot-implement/` (slice 6), `delivery-readings.ts` and `AgentRow` (slice 2). The `implement` workflow (`workflows/implement.ts`) stays untouched. Origin/main moved over the plan's territory once since approval (`c24131d50`, the pulse omission rule); it touches `plan-walk-assembly.ts`, so rebase on it before the pulse step.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
