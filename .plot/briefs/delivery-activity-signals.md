## Implementation brief — delivery-activity-has-three-signals (slice: Signals)

- **Plan (canonical):** `docs/plans/2026-11-20-delivery-activity-has-three-signals.md` on `main`
- **Approved:** 2026-11-20, Jan Wloka, plan-PR #3583 merged
- **Branch:** `feature/delivery-activity-signals` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass
- **Sprint:** `delivery-ui-polish` (plan 6 of 7, tier *should*)

The slice waited on `feature/delivery-work-items-grid` (#3660, merged 2026-11-22), `feature/folded-sections-summarise-visually` (#3629, merged 2026-11-21) and `feature/delivery-tab-has-one-header` (#3607, merged 2026-11-21). All three have landed, so the status column, the extended `headingPace` and the header's Fleet group exist. Start. Read the three merged PRs first: they are your input.

### What to build

The Delivery tab shows activity as three signals with fixed meanings, and nothing else moves. Today the braille spinner sits in a work-item row's Status cell through `statusLead` (`rows.tsx:2039`, `TupleRow.tsx:974`), but only while the row is active, so the status text shifts when it appears. The change highlight is `ChangeMark` (`marks.tsx:95`), an amber `animate-pulse` wash that repeats for `CHANGE_MARK_MS` (3 s). Commit `ef4dc9825` (2026-11-19) removed the activity mark from the Fleet agent rows, which show a static dot only. The slice builds:

1. **Running now.** A spinner slot immediately before the status column, reserved while the row is idle so no text shifts. Pace is `activityPace` (`activity.ts:576`): fast for a local write, slow for waiting on a remote service. A spinner after the status text is the rejected form.
2. **Just changed.** A row whose state changes starts with an accent background that fades out once over about 2 s and never repeats. Reuse `changedRows` (`activity.ts:327`) and `CHANGE_MARK_MS` (`activity.ts:155`); add no second detector. Under `prefers-reduced-motion: reduce` there is no animation and the row's age cell reads `just now`.
3. **Hidden activity.** A spinner beside the header's Fleet group label while any agent works. A folded section's spinner already exists through `headingPace` (`activity.ts:616`, `AgentList.tsx:1838`); verify it follows plan 3's extension to every section and change it only where it does not.
4. **Fleet agent rows** (operator decision 2026-11-20, in the plan's Notes, not in the slice line — it is in scope). Both changes are decided in `agentRowCells` (`packages/domain/src/rules/delivery-row-form.ts:669`) with unit tests; `FleetAgentRow.tsx` renders them and decides nothing.
   - The Doing now cell of a working agent leads with `ActivitySpinner` at the pace `activityPace` names, in a slot reserved while idle. One browser test proves the spinner is seen.
   - The Tokens cell of a running agent shows its context size from the payload's `contextTokens` (`143k ctx`), with `contextSpend` in its title. A finished run keeps `N out` from `lastFinishedRun`; a running agent with no `contextTokens` keeps the dash. Today `tokensCell` (`delivery-row-form.ts:638`) answers `null` for every running agent. `contextTokens` and `contextSpend` are in `contract/schema.ts:4153,4162`.

The design spec is canonical for what the plan does not restate: `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish-design.md`, mockups in `.../2026-11-20-delivery-ui-polish/`, details in `activity-indicators.html`. It lives outside the repository.

### Decisions the plan settles — do not re-derive them

- **Three signals, three meanings.** Running = spinner. Just changed = one fade. Hidden activity = spinner on the folded title or the Fleet group label. The spec's anti-goal is motion with no specific meaning. No shimmering text, except the skeleton rows before the first reading, and nothing flashes permanently.
- **Reuse the detector.** `changedRows` diffs `watchedState` between two pulses and already treats `unknown` as no transition. A second detector would disagree with it. Which rows count as changed stays a view property with a unit test.
- **The header spinner reads `deliveryMapping` in `MineMode` `all`**, as plan 4's header numbers do (`delivery-header.ts:34`). The Mine filter does not change it, and a unit test proves that. A folded section's spinner follows Mine, as plan 3's summaries do. Two readings, deliberately: the header is the whole fleet, a section is what the person filters to.
- **Every rendered state is a domain property** (CLAUDE.md). Which signal a row, a section heading and the header group show, and the `just now` age, are properties with unit tests, not decisions in `.tsx`. A view state that needs a browser to assert is a property not yet extracted. Moving assertions into unit tests updates `stubbed-tests-start-no-board.test.ts` with the reason, as #3575 did.
- **Reduced motion keeps the information.** The spinner already stops on `⠿` under `prefers-reduced-motion: reduce` (`index.css:15,40`). The highlight loses its animation there; the `just now` age carries the fact. Hiding the element would pass a motion-only assertion and lose the information (`ChangeMark`'s own comment states this rule).
- **No mark is implemented by modifying another.** `[data-change-mark]`, `[data-activity-spinner]` and `[data-unpushed-mark]` are separate elements with separate meanings.
- **Absent is not false.** A scan that could not observe a worktree reports absence, not cleanliness: an unreadable row shows no spinner and no fade, never an idle-looking one with a claim.

### Open question — your call, record it in the PR

`CHANGE_MARK_MS` is 3 s and the fade is about 2 s. Either the marker's life becomes the fade's length, or the fade runs inside the 3 s. Pick one, state it in the PR description and in the constant's TSDoc, and assert it with a unit test so the two cannot drift.

### Done when

The plan's behaviour list is the specification:

- a running row shows the spinner in a slot before its status; an idle row keeps the slot, and no text shifts (assert the slot's width equal in both states);
- local activity spins fast, waiting on a remote service spins slow;
- a row whose state changes fades its accent background once, about 2 s, and never repeats on the next pulse (assert that a second pulse with no change lights nothing);
- under reduced motion the fade has no animation and the age cell reads `just now`;
- a folded section and the header's Fleet group show a spinner while any agent or hidden row is active; the header ignores Mine and the section follows it;
- a working Fleet agent leads its Doing now cell with the spinner; a running agent with `contextTokens` shows `143k ctx` and `contextSpend` in the title; a finished run keeps `N out`; a running agent without `contextTokens` keeps the dash;
- no text shimmers outside the skeleton rows.

Assertions a naive implementation passes without: (a) a header spinner built from the Mine-filtered mapping passes every unmounted-filter test — vary `MineMode` and expect one answer; (b) a fade implemented as a repeating CSS animation passes a "has animation" check — assert `animation-iteration-count: 1`; (c) a spinner slot that mounts only when active passes "spinner present" and fails "text does not shift".

Plus: `pnpm build:board` locally to test, and commit **no** bundle — `scripts/check-no-bundle-diff.sh` refuses one. Add a changeset (`'@plot-pm/board': patch`, description first, `bumps:` block last, `plan:` line inside the block). For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `pnpm run test:e2e`: it is CI's gate.

The slice touches no `.sh` file. If that changes, `scripts/check-shell-lines.sh` refuses a PR whose shell is longer than at its merge base; growth is paid for in the same change.

### Bookkeeping

- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.
- Push the first real commit as soon as it exists.
- Arrow functions in everything you write (`packages/domain` and anywhere new); TSDoc states what an export does, not the history of the decision. The domain demands 100% branch coverage: narrow the type rather than test dead code.
- On a conflict in `board-server.mjs`, do not read the diff and do not commit the rebuild: restore the generated path from the merge base (`CLAUDE.md`, *Resolving a board artifact conflict*).

### Scope guard

This branch owns the Delivery tab's activity rendering: `packages/board/src/app/lib/agent-rows/{activity.ts,marks.tsx,rows.tsx}`, `packages/board/src/app/components/{FleetAgentRow.tsx,DeliveryHeader.tsx}`, `packages/board/src/app/index.css` and `styles/delivery-*.css`, `packages/domain/src/rules/delivery-row-form.ts`, and their tests. Siblings in the sprint hold the other six plans of `delivery-ui-polish`; the three merged slices above own the grid, the folded summaries and the header, and this slice extends them rather than rewriting them. The plan's line numbers in `rows.tsx` and `AgentList.tsx` have drifted since 2026-11-20 — the ones above were read on `origin/main` at dispatch. No plan format, template, helper script or `docs/plans` layout changes.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
