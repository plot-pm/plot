## Implementation brief — the-phases-are-declared (wave 2: The card carries its controls)

- **Plan (canonical):** [docs/plans/2026-10-12-the-phases-are-declared.md](../../docs/plans/active/the-phases-are-declared.md) on `main`
- **Approved:** 2026-10-12, Jan Wloka, plan-PR #1608 merged
- **Branch:** `feature/the-card-carries-its-controls` (base: `main`)
- **Ends as:** one PR to `main`, opened with `../plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention; the PR is reviewed as code

Wave 1 (`feature/the-phases-are-a-declaration`) has already merged to `main` as PR #1614 — `packages/domain/src/rules/workflow-phases.ts` exists with `parsePhaseMap`, `DEFAULT_PHASE_MAP`, `phaseOfPlan`, `phaseOfStory`, `planPhases` and `phaseWorkflows`, and `CLAUDE.md` already declares the `Workflow phases` key. **You build on `main` directly — there is nothing to wait on.** Two siblings wait on this branch landing first: `feature/the-board-draws-the-declared-phases` (wave 3, the map switch itself) and `docs/the-prose-names-the-declared-phases`. Checked 2026-10-12: no other branch in flight touches `packages/domain` or `packages/board`.

### What to build

Today three predicates in `packages/board/src/app/components/PlanCard.tsx` decide what a card can do by reading `card.phase` as a column-name literal — `isDraft` is `card.phase === 'Discovery'` (`:83-85`), `isApproved` is `card.phase === 'Development'` (`:62-64`), `isReadyToStart` is `card.phase === 'Development' && card.started === false` (`:40-42`). That is a view decision baked into a `.tsx` file, exactly what CLAUDE.md's *Every rendered state is a domain property* forbids. This slice moves the decision into the domain as `cardControls(readings)`, puts its answer on the wire as `CardSchema.controls`, and makes the three predicates (and the row menu beside them) read that field instead of the phase literal.

**Note what this slice deliberately does NOT do.** `card.phase` itself is still `z.enum(BOARD_PHASES)` (`packages/board/src/contract/schema.ts:425`) after this slice ships, and `board.ts:2082` still calls `toBoardPhase` directly. The map switch — making `phase` a declared string and wiring `board.ts`/`server/fleet.ts`/`mock-fleet.ts` through `phaseOfPlan`/`phaseColumns` — is wave 3's job (`feature/the-board-draws-the-declared-phases`), not this one. You are adding a field the existing phase literals coexist with, not replacing the phase literals yet. The plan's panel round 2 settled this split explicitly so this slice lands the controls under *today's* Discovery/Development mapping — don't widen scope to the map switch.

Build:

1. **`cardControls(readings)`** in a new `packages/domain/src/rules/card-controls.ts`. Signature per the plan's Design section: takes the plan's state, its `status` (the `PlanStatus` that `planStatus` in `rules/phase.ts:117-163` already computes), and `started`. Returns `{ approve: boolean; interrogate: boolean; dispatch: boolean; readyToStart: boolean }` (add `needsDesign` only if you choose to land it here rather than leave it for the later `a-draft-can-need-design` slice — the plan assigns `needsDesign` to that slice, so the straightforward reading is to ship the other four now and let that slice add the fifth key). Rules: `approve` and `interrogate` are true on `draft` or `design` state; `dispatch` is true where `status` is `approved` or `in-progress`; `readyToStart` is true where `dispatch` holds and the plan records no `Started:` (i.e. `!started`).
2. **`CardSchema.controls`** in `packages/board/src/contract/schema.ts`, a new object field near `status` (`:599`) carrying the four booleans above. Computed server-side wherever the card is assembled (`packages/board/src/server/board.ts`) by calling `cardControls` with that plan's state, `planStatus(...)` and `started`.
3. **The three predicates become reads of `controls`.** `isDraft(card)` → `card.controls.approve` (today it's `card.phase === 'Discovery'`; under the current map `draft`/`design` plans are the only ones in Discovery, so this is the same set, read through the new field instead of the column name). `isApproved(card)` → reads whatever `controls` exposes for the Development case — the plan says `controls.dispatch`, so wire `isApproved` to `card.controls.dispatch`. `isReadyToStart(card)` → `card.controls.readyToStart`. Keep the three exported functions with their existing names and doc comments (they're relied on elsewhere) — only their bodies change.
4. **The row menu follows.** `packages/board/src/app/lib/agent-rows/menus.tsx:1464-1466` computes `isDraftPlan = Boolean(card && isDraft(card))`, then `canApprove`/`canCommission` from it — this follows through automatically once `isDraft` itself reads `controls.approve`, so you likely don't need to touch `menus.tsx` directly, only verify it still typechecks and its own tests (which build `Card` fixtures) now need a `controls` field on every fixture.
5. **`board.ts`'s `started` assignment.** The plan says `board.ts:2204` reads `controls.dispatch` — the actual current line for the `started` meta read is `board.ts:1093` (`started: meta.started_raw.length > 0`). Find wherever the server currently computes the three predicates' inputs for the payload (near where `toBoardPhase` is called, `board.ts:2082`) and compute `controls` there via `cardControls`, attaching it to the card object alongside `phase` and `status`.
6. **The `App.tsx:877` citation in the plan does not correspond to anything today** — grepped for `c.status === 'released'` and for any `card.status`/`.status` read in `packages/board/src/app/App.tsx` (1326 lines) and found neither. Either the plan cites a line from before a renumbering, or that specific read was never built. Don't go hunting for a phantom site to "fix" — if `App.tsx` needs no change, say so in the PR rather than forcing an edit to match the plan's stale citation.

### Decisions the plan settles — do not re-derive them

- **Why a `controls` object and not a `state` field on the wire.** The plan's Design section is explicit: distinguishing Draft from Design (both currently read in the Discovery column under today's map) is needed only inside `cardControls`, which runs server-side where the plan's actual state is available. The *wire* carries the already-computed booleans, never the raw state string, so the client makes no state-vs-phase judgment call of its own. Don't add a `state` field to `CardSchema` to make this "cleaner" — that was explicitly rejected (Open Point, resolved: "no `state` field is added").
- **`status` already answers `isApproved`/`isReadyToStart` today, and that doesn't change.** `CardSchema.status` (`schema.ts:599`) is the existing `PlanStatus` enum computed by `planStatus()` in `rules/phase.ts:117-163`. `cardControls` is additive — it consumes `status` as an input, it doesn't replace or duplicate what `status` already answers elsewhere on the card.
- **This is a controls-under-today's-map slice, not a map-switch slice.** The plan deliberately split what could have been one slice into two (wave 2 here, wave 3 next) specifically so the Approve/Interrogate/Dispatch/ReadyToStart decision lands and is tested *before* the Discovery/Design column merge happens. If you find yourself touching `toBoardPhase`, `phaseOfPlan`, `server/fleet.ts`, `mock-fleet.ts`, or the `z.enum(BOARD_PHASES)` wire fields (`schema.ts:425`, `:736`, `:2486`) — stop, that's wave 3's scope.
- **A Design card gaining Approve is this slice's actual externally-visible change.** Under today's map, a `design`-state plan already renders in the Discovery column (same as `draft`), but `isDraft` only ever checked the column, so the distinction between a Draft and a Design plan was invisible to the card. Once `cardControls` keys on *state* (`draft` or `design`) rather than column, both get `approve: true` — which is correct per `phaseWorkflows(DEFAULT_PHASE_MAP)` already granting `approve` to both states (wave 1 shipped that). This is the fix for a known gap the plan's Motivation names: "A Design plan's card offers no Approve today ... while the `approve` transition accepts `design`."
- **Rule carried over, worth not re-breaking:** `approve`/`interrogate`/`dispatch` controls answer *whether the card renders the button*, never whether the underlying command will succeed. The command keeps its own preconditions and refusals; `cardControls` must not duplicate or second-guess them (same principle as `isDraft`'s existing doc comment at `PlanCard.tsx:74-78`, which this slice's new predicate inherits).

### Done when

The plan's `## Design` (*View states are domain properties*, the `cardControls` paragraph) and the *Tests per slice* entry for this slice are the specification:

- `packages/domain/test/card-controls.test.ts` (new) asserts each of the four control booleans for every `(state, status, started)` combination the plan's rule describes — not just the happy path. In particular: `approve`/`interrogate` true for both `draft` and `design`, false for `approved`/`delivered`/`released`; `dispatch` true for `status` `approved` and `in-progress`, false otherwise; `readyToStart` true only where `dispatch` holds AND `started` is false.
- `packages/board/test/integration/approve.browser.test.ts:136` ("offers Approve on NO card outside Discovery") becomes a positive assertion: a Draft card and a Design card both show Approve — not a negative "nowhere else" check, since the whole point is Design (which today shares the Discovery column) now also qualifies.
- Every board unit test building a `Card` fixture and calling `isDraft`/`isApproved`/`isReadyToStart` needs a `controls` field on the fixture now that those functions read it instead of `phase`/`started` directly — find them via `grep -rl "isDraft\|isApproved\|isReadyToStart" packages/board/test`.
- `menus.tsx`'s own fixtures and tests (anything exercising `canApprove`/`canCommission`) pass with no behavior change — this is the regression check that `isDraft` reading `controls.approve` produces the identical answer set as `card.phase === 'Discovery'` did, under today's map.

Plus: a changeset bumping `@plot-pm/board` minor (new card field, new rendered behavior — Design cards gaining Approve is user-visible), description first, `bumps:` block last per CLAUDE.md *Versioning*. Run `node ../plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — for this branch that's `packages/domain/**` vitest-related + `tsc --noEmit`, `packages/board/src/**` vitest-related + `pnpm run typecheck`, and the repo-wide `scripts/check-*.sh` gates. The suites under the `CI suites` config key (`test:e2e`, `test:contracts`, `test:board`, domain coverage, `test/reconcile/*.test.mjs`) run in CI on this PR only — do not run them locally, especially not `test:e2e` (CLAUDE.md *Testing*: it dispatches real workers into sandbox repos).

No `.sh` file should need touching. If one does, `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grows past its merge base with no stored allowance — pay for growth by removing shell elsewhere in the same change.

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

It reads which plan names this branch and opens the PR with the slice heading as title, the plan and this brief in the body. Push the first real commit as soon as it exists — a branch with no PR and no commits is invisible to the fleet. Once the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section, under *The card carries its controls*.

### Scope guard

This branch owns:

- `packages/domain/src/rules/card-controls.ts` (new) — `cardControls`
- `packages/domain/test/card-controls.test.ts` (new)
- `packages/board/src/contract/schema.ts` — `CardSchema.controls` only (not the `phase` enum fields — those are wave 3's)
- `packages/board/src/server/board.ts` — only the site(s) that compute and attach `controls` to the card payload; not `toBoardPhase`, not the column build, not the auto-bump logic
- `packages/board/src/app/components/PlanCard.tsx` — `isDraft`, `isApproved`, `isReadyToStart` bodies only (keep names, exports, and doc comments; update the "why" prose if the predicate's reasoning changes)
- `packages/board/src/app/lib/agent-rows/menus.tsx` — only if typecheck/tests force a change; the control flow should follow through `isDraft`/`isApproved` with no edit needed
- `packages/board/test/integration/approve.browser.test.ts` — the one named assertion at `:136`
- board unit test fixtures that construct `Card` objects and call the three predicates
- one changeset under `.changeset/`

It does not touch `packages/fleet`, `server/fleet.ts`, `mock-fleet.ts`, `rules/workflow-phases.ts`, `rules/phase.ts`'s `toBoardPhase`/`rowPhase`, or any `.sh` script. Re-check with `git fetch` before you push — `feature/the-board-draws-the-declared-phases` and `docs/the-prose-names-the-declared-phases` both wait on this branch and should have no open worktree yet, but confirm.

If you find something the plan did not anticipate — a predicate site the plan doesn't name, a fixture format that doesn't accept the new field cleanly — report it rather than improvising outside scope. In particular, don't start wave 3's map-switch work (`toBoardPhase` callers, the `z.enum(BOARD_PHASES)` wire fields, `phaseColumns`) even if it looks like "finishing the job" — that's a separate slice with its own acceptance criteria.
