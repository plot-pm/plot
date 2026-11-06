## Implementation brief — one-card-grammar (wave 1: Tracer, the approved spike)

- **Plan (canonical):** `docs/plans/2026-11-06-one-card-grammar.md` — read its `## Spec`; this brief orients, the Spec decides
- **Approved:** spike only — `Spike approved: 2026-11-06, jwloka, plan-PR #3192 merged, feature/one-card-grammar-plans`. The plan stays in **Design**; Stories and Tickets wait for a whole-plan approval after this merges.
- **Branch:** `feature/one-card-grammar-plans` (base: **`sprint/card-alignment`**, not `main`)
- **Ends as:** one PR into **`sprint/card-alignment`** — `plot-open-pr.sh --base sprint/card-alignment`. Sprint `card-alignment` (release 2.32.0) is an integration branch: nothing of this sprint reaches `main` until the sprint PR #3195 merges at sprint close. A PR against `main` is wrong.
- **Review of the code:** `plot/review` (required) plus CI `validate`.

Stories (`feature/one-card-grammar-stories`) and Tickets (`feature/one-card-grammar-tickets`) build on what this branch lands — `CardFacts`, the mapping, `<Card>` and both gates. A shape this slice gets wrong is paid for twice.

### What to build

The Plans board's cards — planning and delivery boards and swimlanes — render through one shared `<Card>` from a new domain value, `CardFacts`, instead of `PlanCard.tsx` reading ~16 loose `Card` fields (`controls`, `sliceSummary`, `rounds`, `cost`, `verification`, `prs`, `notPushed`, …) and deciding things itself. Today the same facts sit in different places per board, absence renders as content (`not measured here`, `checks not asked` once per PR — on the 3077 card those chips outweigh its five PRs), and a disabled *Start work* says why only on hover (`StartWorkButton.tsx:331`).

Concretely: `entities/card-facts.ts` (schema), `rules/plan-card-facts.ts` (`planCardFacts`, replacing `planCardView` in `rules/plan-card.ts`), plan `facts` in `/api/board` from the `board.ts` build, `docs/domain/card-grammar.md` (vocabulary), `card-presentation.ts` (`presentCard(facts, board)`), `<Card>`, the schema gate and `scripts/check-card-presentation.sh`.

### Decisions the plan settles — do not re-derive them

- **Facts in the domain, words in the UI.** `CardFacts` holds no generated string: identifiers, ISO dates, and content copied verbatim (`title`, `summary`, `value`) only. Every sentence — *6 PRs · 1 pending*, *waits on feature/x #3105*, *checks unknown*, *not measured here* — is the mapping's. The test for a borderline value: would a CLI or Slack digest need the same value (fact) or phrase it differently (word)? The schema gate enforces this; don't widen its allow-list to make a field pass.
- **The domain's existing vocabulary, imported, not redeclared.** `Checks` (`entities/pr.ts:32`: `green|pending|failing|none|unknown` — not `running`), `HostReach` (`rules/branch-state.ts:34`) for every unknown (`Known<T> = {value} | {unknown: Exclude<HostReach,'ok'>}`), `SpikeCardState`, `PlanStatus`, `PlanType`. A third "unknown" vocabulary was the panel's finding against round 4.
- **Unknown is per item, not per record.** `progress.prs` is a list of `{number, branch, checks}`; *5 green, 1 unknown* must be expressible. A throttled host reads *checks unknown*, never `0` and never omitted.
- **`next.primary` is optional.** `null` is a valid answer (a plan whose only action is *Interrogate* has it as a secondary). `reason` is non-null exactly when `enabled` is false.
- **Reasons come from the real refusals, not a wish list.** `startRefusal` (`StartWorkButton.tsx:59-68`) gives three: dispatch unavailable (`action-unavailable` — board-wide config; the card points at the action, the board's own action entry carries the sentence), no fleet scan yet (`awaiting-fleet-scan`), nothing eligible (`nothing-eligible` with the pulse's `blockedBy` slices as `waitsOn`). There is **no `started` reason**: *Start work* stays enabled on an in-progress plan to dispatch the next wave (`PlanCard.tsx:520`); `readyToStart` decides primary vs secondary only.
- **`cardControls` stays** with its schema and callers; `planCardFacts` reads it as `next`'s input. Do not fold it away.
- **Every fact today's plan card shows survives**: type, rounds, spike state, verification, cost, `not-pushed`, the PR list, story and sprint (as `lineage`), path (as `ownership.source`). The panel's top finding was that the first draft silently dropped six of them.
- **Compute on the server, once per build**, in `board.ts` where `planCardView`/`cardControls` run. No cache — nothing has measured the build as slow.
- **`/api/board` changes per kind:** add `facts` to plans; remove a plan field only once nothing reads it — check filters, `Swimlanes.tsx`, `PlanModal`, menus, `mock-fleet.ts` (emits facts through the same projection), `release-smoke.sh` (counts cards only), `plot-ask.mjs board`.
- **`planCardView` retires in this slice** with its tests moved to `planCardFacts`; no deprecated wrapper.
- **Title is the only open link; one action row.** No separate *Open* word; primary first, then enabled secondaries; a disabled primary shows its reason on the card. Planning/delivery boards and swimlanes emphasise `next`.
- Carried over, because this repo keeps re-learning them: **absent is not false** (an unread input is `unknown`, never `[]`); **read the exit code, not the emptiness**; domain code is arrow functions with factual TSDoc — reasoning goes in commits, not comments.

### Done when

The plan's Spec `### Done when → Tracer` is the specification. The assertions that exist because a naive implementation passes without them:

- **Every fact still shows** — type, rounds, spike state, verification, cost, `not-pushed`, PR list. Catches the facet-less field quietly disappearing when old `Card` fields go.
- **No *not measured here* / *checks not asked* chip of its own** — each is an unknown inside its row. Catches re-rendering the old noise through the new component.
- **A disabled *Start work* names its reason on the card**, not in a `title` tooltip. Catches porting the hover behaviour as-is.
- **A throttled-host fixture reads *checks unknown*, never zero.** Catches `Known` collapsed to a default.
- **Both gates fail on a seeded violation** (a free-text field on `CardFacts`; an import of a reading in `card-presentation.ts`) and pass on the branch. Catches gates that pass vacuously.
- **One browser test** proves rows and tab order (title, primary, secondaries, expanders; expanders are `<button aria-expanded>`).

Plus the repo's gates: wire `scripts/check-card-presentation.sh` into `ci.yml` and the `Local checks` key in `CLAUDE.md`, then `./scripts/check-agents-md.sh --write`. A changeset for `@plot-pm/board` (description first, `plan: docs/plans/2026-11-06-one-card-grammar.md` in the trailing block). Do not commit a generated bundle (`check-no-bundle-diff.sh`). For tests: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the `CI suites` run in CI and a failure comes back as a correction. Do not run `test:e2e` locally. The shell gate (`scripts/check-shell-lines.sh`) counts shell under `skills/` only — the new check script lives in `scripts/`, so it costs nothing there; touch no `.sh` under `skills/`.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh --base sprint/card-alignment` (`--draft` while moving) — never `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` — on `sprint/card-alignment`.

### Scope guard

This branch owns: `packages/domain/src/entities/card-facts.ts`, `packages/domain/src/rules/plan-card-facts.ts` and `rules/plan-card.ts` (retired), `docs/domain/card-grammar.md`, `packages/board/src/app/` card presentation, `<Card>`, `PlanCard.tsx`, the plan-card call sites in `Board.tsx` / `Swimlanes.tsx` / `PlanModal`, plan facts in `packages/board/src/server/board.ts` and `mock-fleet.ts`, `scripts/check-card-presentation.sh`, `.github/workflows/ci.yml`, the `Local checks` line in `CLAUDE.md` / `AGENTS.md`.

Not this branch: story or ticket cards, `storyCardView`, `ticketCard*`, `discovery-lanes.ts`, `/api/idea`, `/api/story`, `StoryModal`, the story `issue:` field — all Stories/Tickets. Other work in flight: sprint `follow-ups-2-30-1` (another session, release 2.31.0) lands on `main` and may touch `packages/board`; merge `origin/main` into `sprint/card-alignment` (not into this branch) when it does.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
