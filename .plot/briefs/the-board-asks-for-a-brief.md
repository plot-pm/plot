## Implementation brief — the-board-asks-for-a-brief (slice: Auto-dispatch asks for the brief it is missing)

- **Plan (canonical):** `docs/plans/2026-09-06-a-dispatch-action-asks-for-its-brief.md` on `main`
- **Story:** `the-master-agent-holds-the-fleet`
- **Branch:** `feature/the-board-asks-for-a-brief` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR
- **The plan carries nine interrogation rounds.** Read its Notes before writing code — most of what a first attempt would get wrong is already recorded there as a defect somebody found.

## What this delivers

Auto-dispatch reaches `/api/implement` for a branch it would otherwise skip, instead of filtering it out in silence.

**This is the ONE door that still goes quiet.** `plot-dispatch.sh` asks the `Brief command`; `Start work` posts to `/api/dispatch`, which spawns that same script; `WriteBriefButton` offers the remedy on the row. Only `auto-dispatch.ts:449` and `:494` filter an unbriefed branch out and log a skip nobody reads.

## Reach the route, do not reimplement it

**`WriteBriefButton` is a label over `ImplementButton` for exactly this reason** — *"two implementations of one click is the duplication `one-place-for-what-a-row-can-do` exists to prevent"*. A loop with its own spawner would be the third copy. Use `/api/implement`.

## Seven requirements, each with the measurement behind it

**ONE ASK PER PLAN, NOT PER BRANCH.** The route takes a **slug** and `/plot-implement` prepares a plan. Measured 2026-09-06: `the-workflow-owns-the-word-phase` had 2 unbriefed branches, `every-element-is-a-domain-concept` 1 — so a per-branch ask runs one command twice against one plan, in two sessions, with no lock. `PLOT_BRIEF_BRANCH` looks like it scopes a session and does not: `/plot-implement` names it zero times.

**ITS OWN MARK — THE IN-FLIGHT MARK CANNOT BE REUSED.** `pruneInFlight` retires when the pulse shows a branch claimed, merged, gone, or held by a live registry entry. A brief produces **none** of those: `isStartable` keeps answering true, the mark never drops, and every ask costs a permanent slot against `parallelAgents`. Retire on the reading that matches — a non-empty brief on `origin/main`, which `findMissingBriefs` already takes every pulse.

**THE MARK SURVIVES A RESTART.** It is an in-memory `Set` today (`auto-deliver.ts` has the same shape). A restart mid-ask forgets it, the next pulse asks again while the first session runs, and that is the duplicate-session collision by another route. `.plot/state/` holds `fleet-controls.json` and `last-pulse.json` — durability has a home and a precedent there.

**NON-EMPTY, NOT PRESENT.** `registryd-main.ts:341` calls the existence check *"the weaker half"* beside the shell's hand-over gate, which refuses a zero-byte brief. A session dying mid-write pushes a partial file. **The two halves ask one question or the weaker one decides.**

**BOUNDED, AND A FAILING PLAN GOES TO A PERSON.** `startFreeAgent` bounds a start at 60 s; a brief session is detached and waited on by nobody. Bound it — minutes, not the fleet's 8 h `Worker bound` — and after a bounded number of failed asks **record it in the plan file**. `PLOT-BLOCKED` is a desk marker and a plan with no brief has no desk. A board-side counter was rejected: it dies on restart, so a restart silently retries a command that cannot work.

**ONE BUDGET, AND A FULL FLEET CORRECTLY BLOCKS THE ASK.** Draw on `parallelAgents`. Measured: 6 agents against a cap of 5 meant no ask could fire — that is the design. A brief is worth writing only if an agent can then take the slice.

**OFF BY DEFAULT.** This is the first time the loop writes without a click. `plot-registryd --start-agents` is the precedent — opt-in, and *"a run without the flag changes nothing on the machine"*. The cost is stated in the plan: an estate that never opts in keeps today's silence.

## The row

**BOTH STATES ALREADY EXIST — invent no value.** `WaitingOnSchema` admits `'you' | 'click' | 'time'`, and `waitingTone` (`row-identity.ts:213`) renders `'time'` in slate: waiting on the machine. The row moves `you → time` while a session is writing. **A reader scanning for their own errands must not see a row a machine is already handling.**

**IT ANNOUNCES POLITELY.** The badge is a `role="gridcell"` of static text, and this is the **first row state on the board that changes with no click** — every other change follows a person acting or an agent pushing. `StatusPanel.tsx:192` uses `aria-live="polite"`; follow it.

**AMBER RETURNS IF THE ASK FAILS.** `'time'` is not a promise. The bound and the plan-file record are what handle failure; the colour follows the current reading.

## Two off switches

The auto-dispatch toggle stops the asking live, because the asking is part of that loop. **`Implement command: none` stops it for the project** — the config already reads `none` as *we do this by hand*, and the board must honour that answer rather than invent a second way to say it.

## Done when

- the asking is off by default and a project can turn it on
- auto-dispatch asks at most once per plan per pass, reaching `/api/implement`
- the ask draws on the agent cap
- its mark retires only on a **non-empty** brief on `origin/main`, and survives a board restart
- a session past its bound is reported; a plan whose asks keep failing is recorded in its plan file
- the row moves `you → time` while a session writes, and announces it politely
- either off switch stops it
- `pnpm test`, `pnpm run test:reconcile` and `pnpm run test:board` pass

## Do not

- **Do not spawn your own session.** Reach `/api/implement`; a third copy of one click is what `WriteBriefButton` exists to avoid.
- **Do not reuse the in-flight mark.** It cannot retire on a brief and would leak the budget one slot per ask.
- **Do not ask per branch.** The command is per plan, and two sessions on one plan have no lock between them.
- **Do not invent a `WaitingOn` value.** `'time'` is the one you need.
- **Do not ship it on.** Off by default, opt in per project.
- **Do not weaken the brief gate.** No slice starts without a brief; only the response to a missing one changes.
- **Do not run `pnpm run test:e2e`.** CI is its gate.
- **`pnpm run typecheck` covers `@plot-pm/board` only.** Run `pnpm --filter @plot-pm/domain exec tsc --noEmit -p tsconfig.json` if you touch the domain — vitest passes where `tsc` fails.
