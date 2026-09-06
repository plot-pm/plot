# Auto-dispatch asks for the brief it is missing

> Nine eligible slices sat unbriefed for hours while eight agents idled. Seven interrogation rounds found that the remedy already shipped — a *Write brief* button, a refusal that names the fix, a route that runs the skill — and that one unset config key made all of it inert. What is still missing is one thing: the unattended loop skips a slice with no brief and asks nobody.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 8

## Changelog

- The unattended dispatch loop asks for a missing brief instead of skipping in silence.

<!-- Board impact: auto-dispatch gains a step and the row gains a state. The
     button, the route and the refusal already exist and are unchanged. -->

## Motivation

**A slice with no brief is not started.** `auto-dispatch.ts:911` states it, and `findMissingBriefs` enforces it against `origin/main` rather than the filesystem, so a lagging checkout cannot be wrong about main. That rule is right and this plan does not touch it.

**THE HUMAN PATH IS COMPLETE, AND SEVEN ROUNDS WERE NEEDED TO SEE IT.**

| what a person meets | what it does |
|---|---|
| `WriteBriefButton` | *"the way out of the refusal, offered where the refusal is read"* — delegates to `/api/implement` |
| `/api/dispatch` | refuses `no-implement-command` and names the fix |
| `/api/implement` | the board's eighth state-changing route, runs `/plot-implement <slug>` |
| `plot-dispatch.sh` | asks the `Brief command` for a branch it cannot start |

**One key made all of it inert.** `Implement command` was unset here until 2026-09-06. So the button rendered and could not act, and every dispatch refused with `no-implement-command` — **which is why nine slices sat unbriefed while the fix was one click away on the row that showed the problem.** Setting the key stopped the refusal immediately, measured against the live board.

**WHAT REMAINS MISSING IS ONE PATH.** `auto-dispatch.ts:449` filters an unbriefed branch out of the startable set and logs a skip. Nobody is asked, and the log is written where nobody is reading. **It is the only door onto dispatch that meets a missing brief and does nothing about it.**

**That is a smaller claim than this plan opened with**, and it is the one the estate supports.

## What this is not

**Not a weakening of the brief gate.** No slice starts without a brief. The change is what happens instead of stopping.

**Not the board taking a new kind of action.** `row-identity.ts:152` records an Open Point — *whether the board should offer the brief-writing action* — declined because *"running `/plot-implement` is a real write, and the board's line is drawn at the acting endpoints it already has."* That line is not crossed: the brief is an intermediate step inside dispatch, which `plot-dispatch.sh:429` already calls *"that step"*, and the acting endpoint stays `/api/dispatch`.

**Not a new button, a new route, or a new runner.** All three exist. This plan reaches them from the loop that does not.

**Not a fix for the shell's `Brief command` prompt.** Its two real invocations both died with `Unknown command: /plot-implement` — 33 bytes each, 2026-09-02 and 2026-09-04 — because `plot-implement` is a skill and the prompt opens with a bare slash command. `composeImplementPrompt` uses the other form, *"Run /plot-implement <slug> and follow it."* **Both keys stay**: `plot-dispatch.sh` runs in repositories with no board and cannot read the board's key. Making the shell's form work is [`the-brief-command-invokes-a-skill`](2026-09-06-the-brief-command-invokes-a-skill.md).

## Slices

### Auto-dispatch asks for the brief it is missing (Branch: feature/the-board-asks-for-a-brief)

Auto-dispatch reaches `/api/implement` for a branch it would otherwise skip, and reports what it started.

**IT REACHES THE ROUTE, IT DOES NOT REIMPLEMENT IT.** `WriteBriefButton` is a label over `ImplementButton` for exactly this reason — *"two implementations of one click is the duplication `one-place-for-what-a-row-can-do` exists to prevent"*. A loop with its own spawner would be the third copy.

**ONE ASK PER PLAN, NOT PER BRANCH.** The route takes a **slug** and `/plot-implement` prepares a plan, not a branch. Measured 2026-09-06: `the-workflow-owns-the-word-phase` carried 2 unbriefed branches and `every-element-is-a-domain-concept` 1, so a per-branch ask would run one command twice against one plan, in two sessions, with no lock between them. `PLOT_BRIEF_BRANCH` looks like it scopes a session and does not — `/plot-implement` names it zero times.

**THE MARK IS ITS OWN, AND THE IN-FLIGHT MARK CANNOT BE REUSED.** `pruneInFlight` retires when the pulse shows a branch claimed, merged, gone, or held by a live registry entry. **A brief produces none of those**: `isStartable` still answers true, the mark never drops, and every ask would cost a permanent slot against `parallelAgents`. The ask's mark retires on the reading that matches it — a **non-empty** brief on `origin/main`, which `findMissingBriefs` already takes every pulse.

**NON-EMPTY, NOT PRESENT.** `registryd-main.ts:341` calls the existence check *"the weaker half"* beside the shell's hand-over gate, which refuses a zero-byte brief. A session dying mid-write can push a partial file. The two halves ask one question or the weaker one decides.

**BOUNDED, AND A PLAN THAT KEEPS FAILING GOES TO A PERSON.** `startFreeAgent` bounds a start at 60 s; a brief session is spawned detached and waited on by nobody. It gains a bound, and after a bounded number of failed asks **the plan file records that it needs a person** — `PLOT-BLOCKED` is a desk marker and a plan with no brief has no desk. A board-side counter was rejected: it dies on restart, so a restart silently retries a command that cannot work, which is the state this estate was in for four days.

**ONE BUDGET, AND A FULL FLEET CORRECTLY BLOCKS THE ASK.** A brief session draws on `parallelAgents`. Measured 2026-09-06: 6 agents against a cap of 5, so no ask could fire at all — which is the designed answer rather than a bug. **A brief is only worth writing if an agent can then take the slice**; asking while the fleet is full prepares work nobody can act on for hours, and the brief would be stale by the time anyone did. A second cap for writes-to-main was rejected: one number to reason about, with the blast radius bounded by the off switches.

**IT SHIPS OFF, AND A PROJECT TURNS IT ON KNOWINGLY.** This is the first time the loop writes without a click — an unattended session that commits to `main` — and `plot-registryd`'s `--start-agents` already has this shape for the same reason: *"it is opt-in: a tick with a queue nothing can take starts free agents"*, and *"a run without the flag changes nothing on the machine"*. A project that has never seen this loop write should not discover it by having it write.

**The cost is stated: an estate that never opts in keeps today's silence.** That is the outage this plan opened with, and it is the price of not surprising a repository that did not ask. The refusal already names the fix, and the button already works once `Implement command` is set — a project reading either has what it needs to opt in.

**TWO OFF SWITCHES, STOPPING DIFFERENT THINGS.** The auto-dispatch toggle stops the asking live, because the asking is part of that loop. `Implement command: none` stops it for the project — the config already reads `none` as *we do this by hand*, and the board must honour that answer rather than invent a second way to say it.

**THE ROW GAINS A THIRD STATE.** `rows.tsx:2056` renders `needs a brief` in the `waitingOn: 'you'` amber and says why: *"A missing brief is a person's errand and nothing in git will clear it."* Once the loop asks, something does. Amber stays until a brief **exists** — the ask can fail and has — and a quieter state says *asked, waiting*.

**Done when** the asking is off by default and a project can turn it on, auto-dispatch asks at most once per plan per pass, the ask reaches `/api/implement` rather than spawning its own, it draws on the agent cap, its mark retires only on a non-empty brief on `origin/main`, a session past its bound is reported, a plan whose asks keep failing is recorded in its plan file, the row distinguishes *asked, waiting* from *needs a brief*, and either off switch stops it.

## Notes

### What seven rounds cost and bought — 2026-09-06

The plan opened claiming three dispatch doors go quiet on a missing brief. **One does.** Each round removed something:

| round | finding |
|---|---|
| 1 | `Start work` already asks — its slice deleted |
| 2 | the ask was keyed by branch, the command by plan — two sessions on one plan |
| 3 | the shell's `Brief command` has never once worked, 2 of 2 runs |
| 4 | `/plot-implement` creates branches and writes `Started:`; a ref **is** a claim |
| 5 | a prior plan's Open Point was being crossed unknowingly — reframed, not reversed |
| 6 | the log the plan promised to name is one the board cannot serve |
| 7 | `WriteBriefButton`, `/api/implement` and the refusal all already ship |

**Round 7 is the one that mattered most**, and it is the cheapest outcome available: finding a feature already built prevents the whole build. What it left is one loop and a config key.

### The config key was the outage — 2026-09-06

`Implement command` was unset. `WriteBriefButton` rendered and could not act; `/api/dispatch` refused every slice with `no-implement-command`. **Nine slices sat unbriefed for hours with the remedy one click away, disabled by a key nobody had set.**

Setting it stopped the refusal immediately — verified against the live board, `no-implement-command` gone from the payload.

**A feature that ships without its config key ships disabled**, and nothing on this estate said so — no lint, no scan section, no board warning. `plot-detect-repo.sh` proposes config at adoption and nothing re-checks it when a later feature adds a key. That gap is real and unrecorded; it is not this plan's, and it should not be lost.

### Round 8 — 2026-09-06

**The claim reproduces on a live tick.** With auto-dispatch **on**, `Implement command` **set**, and 6 agents running: `no-brief=3`, and all three sat there while nothing asked. The plan's one remaining claim is not theoretical.

**And the tick surfaced a defect outside this plan.** `bug/the-reaper-reads-prunable` was among the three — but its plan says in bold prose *"IT WAITS FOR `a-desk-is-finished-with-once` (#705)"*, and #705 is an **unmerged idea branch**, so its plan is not on main and reads `phase: NONE`.

**The wait existed only as prose.** `waits:` is a parsed annotation carrying `waits_on`, used by 6 plans, and that slice's heading carried none — so the machine read it as eligible and a person withheld the brief by hand. **A wait a reader can see and a machine cannot is a rule**, and this repo's own test says a rule that matters gets a gate. The annotation is added; a sweep found this was the only plan with the gap.

**Two decisions settled:**

- **Off by default.** The first unattended write to `main` should not arrive unannounced, and `--start-agents` is the precedent — opt-in, and a run without it changes nothing on the machine. The cost is that an estate which never opts in keeps today's silence.
- **A full fleet correctly blocks the ask.** 6 agents against a cap of 5 means no ask could fire, which is the design: a brief is worth writing only if an agent can then take the slice.
