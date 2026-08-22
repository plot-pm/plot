# DONE means testing, and sixteen plans never left Development

> Every branch of sixteen plans is merged and every one still reads `Approved`.
> The estate detects it, nothing acts on it, and the phase it should reach is
> called Endgame when the work it names is testing.

## Status

- **Phase:** Draft
- **Type:** bug
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches

## Changelog

- A plan whose waves have all merged reaches Testing without anyone remembering
  to run `/plot-deliver`, and the plan row offers Deliver when testing is done.
- The phase after Development is called **Testing**, which is what happens in it.

<!-- Board impact: `BOARD_PHASES` is a contract enum and one of its members is
     renamed; 13 plan files carry the old word. The Deliver action is a board
     write that wraps `/plot-deliver`, the sanctioned shape. -->

## Motivation

Measured 2026-08-21 from the operator's screenshot of DONE and confirmed against
the estate:

    plot-reconcile-scan.sh → merged_not_delivered=16
    DONE section          → 15 plans reading `Development`, 2 reading `Endgame`

`toBoardPhase` maps `approved → Development` and `delivered → Endgame`
(`packages/board/src/contract/schema.ts:512-520`), so the board is telling the
truth: those plans really are still `Approved`. The two showing Endgame are the
only two anybody delivered by hand.

**The detection already works.** `plot-reconcile-scan.sh` section 2 finds every
one, names the merged PRs, and prints the command:

    2026-08-17-working-shows-the-agent.md — impl branch merged to main, plan still Approved (PRs: none-linked)
      merged PR head: #270, #241, #295, #246, #244, #239
      consider: /plot-deliver working-shows-the-agent

The gap is between *detected* and *acted on*. The scan is a command a person
runs; the board is where the question is asked, and it shows a phase that has
quietly stopped being true.

**The phase is also misnamed.** *Endgame* names a position, not an activity —
and the operator's framing says what actually happens there: *"die Phase Testing
(aka Endgame)"*. Every neighbouring phase is named for the work in it —
Discovery, Design, Development — and then the one where verification and signoff
happen is named for a chess metaphor.

## Design

### Three changes, and the middle one is the point

**1. Merged waves reach Testing on their own.** *"Wenn alle WAVES eines Planes
gemerged sind müssen wir in TESTING sein."* This is a transition the board may
compute, because the input is checkable without judgement: every wave of the
plan has a merged branch. It is the same licence
`plot-resolve-artifact.sh` documents — *"judgement's absence IS the
permission"* — and the same shape the scan already applies when it says
`merged_not_delivered`.

What it must NOT do is deliver. Testing is where a person verifies; reaching it
automatically only asserts *the code has landed*, which git already knows.

**2. A `Deliver` action on the plan row.** *"Falls das Testing gut läuft
brauchen wir eine neue Action für Plan Row 'Deliver'."* It spawns
`/plot-deliver <slug>` — the sanctioned board write, wrapping a skill rather
than inventing a transition, the way `/api/idea` wraps `/plot-idea`.

**Not `/plot-reconcile` afterwards.** The scan is read-only and estate-wide: it
FINDS candidates and suggests `/plot-deliver`, so it belongs *before* the action,
not after. `/plot-deliver` already verifies PRs (step 4), completeness (5),
carries its own Delivery-Landed gate (7b) and updates the board (8). A reconcile
run after it would confirm a disappearance, not cause one.

**3. Endgame → Testing.** A rename across a contract enum, 55 source
occurrences and 13 plan files.

### What blocks the Deliver action today

`/plot-deliver` verifies through the `→ #N` annotations in a plan's `##
Branches` section, written by the implementing worker — CLAUDE.md instructs it to
*"append the PR number to this branch's line"*. Measured with
`plot-plan-meta.sh`: **12 of the 16 have zero annotations**, four are partial,
one is complete (`a-rate-limit-is-not-an-outage`, 4 branches / 4 PRs).

So the button would refuse on 15 of 16 rows. The scan does not need them — it
matches merged PR heads to branch names, which is why its output says
`PRs: none-linked` and lists the PRs anyway.

Two ways out, and the plan should argue for the second:

- Repair the annotations, then the button works. Fixes today's 16 and nothing
  about tomorrow's.
- Teach `/plot-deliver` the scan's method — match merged PR heads to branch
  names where annotations are absent. Then the button works on any plan, and the
  annotations become a convenience rather than a precondition.

The annotation gap itself is the third *rule-without-a-gate* found today: a
worker is told to annotate and did not, in 12 of 16 cases.

### Open Questions

- [ ] Does `/plot-deliver` refuse a plan whose `Done when` list has unticked
      items, or only check PRs? It decides whether Deliver is safe to offer on a
      row whose testing nobody did.
- [ ] Is `Testing` reached per plan, or per wave? A plan with three waves where
      two are merged is not in testing — but is it still Development, or is the
      phase per-wave?
- [ ] The rename touches 13 plan files carrying `Endgame` in prose. Rewrite them,
      or leave history alone and rename only the enum?

## Branches

### Reached

- `feature/merged-waves-reach-testing` — a plan whose every wave holds a merged
  branch reports the phase after Development rather than Development. Tests: all
  waves merged → the later phase; one wave open → Development; a deferred branch
  does not block it, matching the scan's own rule; a plan already `delivered`
  is untouched; the derivation is the server's and is not remade in the renderer.

### Named

- `feature/the-phase-after-development-is-testing` — `Endgame` becomes `Testing`
  through `BOARD_PHASES`, its mapping and every reader. Tests: the contract enum
  carries `Testing` and not `Endgame`; `toBoardPhase('delivered')` returns it;
  the board column header reads it; no source file under `packages/board/src`
  matches `Endgame`; the 13 plan files are handled per the Open Question above.

### Offered

- `feature/the-plan-row-offers-deliver` — the plan row gains a `Deliver` action
  spawning `/plot-deliver <slug>`, wrapping the skill rather than writing the
  transition. Tests: the item appears only on a plan whose waves are all merged;
  it is absent where the server would refuse and NAMES the refusal on the
  control; the click spawns and writes nothing itself; a `delivered` plan offers
  nothing; the route refuses a non-localhost binding, like every other spawn.

### Verified

- `feature/deliver-finds-prs-without-annotations` — `/plot-deliver` matches
  merged PR heads to branch names where a plan carries no `→ #N` annotation,
  which is what `plot-reconcile-scan.sh` already does. Tests: a plan with zero
  annotations and all branches merged verifies; one with an unmerged branch
  refuses and names it; annotations, where present, still win; the host is asked
  through `plot-host.sh` and never directly.

## Notes

Found while answering *"kannst du die plan statusse aktualisieren?"* — the
answer being that a mass edit is the wrong shape: sixteen lifecycle transitions,
each of which `/plot-deliver` exists to verify.

The operator settled the target phase and the action in one message: *"Wir
sollten die Phase Endgame nach Testing umbenennen und wenn alle WAVES eines
Planes gemerged sind müssen wir in TESTING sein. Falls das Testing gut läuft
brauchen wir eine neue Action für Plan Row 'Deliver'."*
