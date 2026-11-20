# Delivery activity shows as three signals with fixed meanings

> The Delivery tab shows activity with three signals only: a spinner in a reserved slot before the status column while a row runs, a background that fades once when a row's state changes, and a spinner beside a folded section's title or the header's Fleet group while hidden rows are active, each with a reduced-motion alternative.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** delivery-ui-polish
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-20, Jan Wloka, plan-PR #3583 merged

## Changelog

- A row that runs now shows the braille spinner in a slot just before its status. The slot stays reserved when the row is idle, so no text shifts. Local activity spins fast, waiting on a remote service spins slow.
- A row whose state changes starts with an accent background that fades out once over about 2 s, and never repeats. With reduced motion there is no animation and the age cell reads "just now".
- A folded section shows a spinner beside its title, and the header's Fleet group shows one beside its label, while any agent or hidden row is active.
- No text shimmers except the skeleton rows before the first reading, and nothing flashes permanently.

<!-- Board impact: the Delivery tab only (packages/board, packages/domain). No plan format, template, helper script or docs/plans layout changes. A builder runs `pnpm build:board` locally to test a slice and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one. -->

## Motivation

Plan 6 of 7 of the sprint "Delivery UI Polish", tier *should*. The approved design spec is `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish-design.md` (outside this repository), with mockups in `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish/`; `activity-indicators.html` holds this plan's details. The spec is canonical for everything this plan does not restate.

The spec's anti-goal: *motion that does not mean anything specific (permanent flashing, shimmering text).* This plan implements goal 11 and the spec's *Activity* section. The operator asked the question; the three signals are the spec's proposed answer (spec call).

## Design

### Approach

- **Running now.** The braille spinner (`ActivitySpinner`, `packages/board/src/app/lib/agent-rows/marks.tsx:21`, #3575) sits in a reserved slot immediately before the status column; the slot is reserved when idle so text never shifts. Pace follows today's rule, `activityPace` (`packages/board/src/app/lib/agent-rows/activity.ts:576`): fast frames for local activity, slow for remote waiting. Not used: a spinner after the status text.
- **Just changed.** When a row's state changes, its background starts in the accent colour and fades out once over about 2 s, never repeating. Change detection exists: `changedRows` (`activity.ts:327`) diffs `watchedState` between two pulses, and `CHANGE_MARK_MS` (`activity.ts:155`) holds the marker 3 s today. Reuse it and set the fade's length; do not add a second detector. Which rows count as changed stays a view property with a unit test.
- **Hidden activity.** A spinner beside a folded section's title (`headingPace`, `activity.ts:616`, which plan 3 extends to every section) and beside the header's Fleet group label while any agent works (plan 4's header). The header's spinner reads the same `deliveryMapping` in `MineMode` `all` as plan 4's header numbers, so the Mine filter does not change it, with a unit test; a folded section's spinner follows Mine, as plan 3's summaries do.
- **Reduced motion.** Every animation has a `prefers-reduced-motion` alternative. The spinner already stops under `prefers-reduced-motion: reduce` (`packages/board/src/app/index.css:15,40`). The change highlight has no animation there, and the row's age cell reads "just now".
- **Not used.** Shimmering text, except skeleton rows before the first reading; permanent flashing.
- **Every rendered state is a domain property** (CLAUDE.md). Which signal a row, a section heading and the header group show, and the "just now" age, are view properties with unit tests. Moving assertions into unit tests updates `stubbed-tests-start-no-board.test.ts` with the reason, as #3575 did.

### Open Questions

- [ ] The fade lasts about 2 s; `CHANGE_MARK_MS` is 3 s today. Does the marker's life become the fade's length, or does the fade run inside the 3 s? Builder's call.

## Slices

### Signals

- `feature/delivery-activity-signals` <!-- waits: feature/delivery-work-items-grid, feature/folded-sections-summarise-visually, feature/delivery-tab-has-one-header --> — the reserved spinner slot before the status column, the once-only change fade from `changedRows` with its reduced-motion "just now", and the spinner beside the header's Fleet group label <!-- builds: activitySignal, the activity signal of a Delivery row, heading and header group -->

## Notes

- Created by `/plot-idea` in one batch with the other six plans of the sprint "Delivery UI Polish". Type `feature` came from the brief; the design question was answered no, because the design spec already exists outside the repository, so the plan starts in Draft.
- Waits on three slices of other plans, named in the `waits:` marker: plan 5's `feature/delivery-work-items-grid` (the status column the slot sits before), plan 3's `feature/folded-sections-summarise-visually` (the heading spinner) and plan 4's `feature/delivery-tab-has-one-header` (the Fleet group label).

- **The Fleet agent rows carry the running signal and a running agent's tokens** (operator decision, 2026-11-20). Commit `ef4dc9825` (2026-11-19) removed the activity mark from the agent rows, so `FleetAgentRow.tsx` shows only a static dot per group (`delivery-fleet.css:134-141`) and the braille spinner sits only in work-item rows (`agent-rows/rows.tsx:2064`). Two changes, both decided in `agentRowCells` (`rules/delivery-row-form.ts`) with unit tests, and `FleetAgentRow.tsx` renders them and decides nothing:
  - The Doing now cell of a working agent leads with `ActivitySpinner` at the pace `activityPace` names, in a slot reserved while idle so the text does not shift. One browser test proves the spinner is seen.
  - The Tokens cell of a running agent shows its context size from the payload's `contextTokens` (for example `143k ctx`), with `contextSpend` in its title. A finished run keeps `N out` from `lastFinishedRun`, and a running agent with no `contextTokens` keeps the dash. Today `tokensCell` (`delivery-row-form.ts:646-652`) answers `null` for every running agent.
