# DONE means testing, and sixteen plans never left Development

> Every branch of sixteen plans is merged and every one still reads `Approved`.
> The estate detects it, nothing acts on it, and the phase it should reach is
> called Endgame when the work it names is testing.

## Status

- **Phase:** Approved
- **Type:** bug
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-08-23, Jan Wloka, in-session
- **Started:** 2026-08-23, Jan Wloka, `feature/merged-waves-reach-testing`
- **Started:** 2026-08-23, Jan Wloka, `feature/deliver-finds-prs-without-annotations`
- **Started:** 2026-08-23, Jan Wloka, `feature/the-plan-row-offers-deliver`
- **Started:** 2026-08-23, Jan Wloka, `feature/the-phase-after-development-is-testing`

## Approval

- **Assignee:** Jan Wloka

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

**Re-measured 2026-08-22: `merged_not_delivered=2`.** Fourteen of the sixteen
were delivered by hand that morning — each one needing its phase flipped, its
`Delivered:` record written, its symlink moved, and in most cases its PR
annotations back-filled first. That drain is not a refutation of this plan; it
is its argument, performed. Detection worked the whole time and nothing acted
on it, so clearing the backlog cost a person a morning, and the count will
refill the next time a fleet lands work.

The two that remain are the same shape as the sixteen: both read
`PRs: none-linked`, so both would still refuse the button this plan proposes.

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

**3. Endgame → Testing.** A rename across a contract enum: measured
2026-08-22, **17 occurrences in `packages/board/src`, 37 in its tests** and 13
plan files. `Endgame` is a value in `BOARD_PHASES`, so this is a wire-format
change rather than a label change, and the client compares the literal
(`Board.tsx:198` gates the checklist on `column.phase === 'Endgame'`).

**Nothing persists the word**, which is what makes it safe: it appears in no
pulse file and no stored state, so old and new never meet and no migration is
needed. It is therefore a single-commit sweep — but a wide one, which is why it
goes last and alone.

### What blocks the Deliver action today

`/plot-deliver` verifies through the `→ #N` annotations in a plan's `##
Branches` section, written by the implementing worker — CLAUDE.md instructs it to
*"append the PR number to this branch's line"*. Measured with
`plot-plan-meta.sh`: **12 of the 16 have zero annotations**, four are partial,
one is complete (`a-rate-limit-is-not-an-outage`, 4 branches / 4 PRs).

So the button would refuse on 15 of 16 rows. The scan does not need them — it
matches merged PR heads to branch names, which is why its output says
`PRs: none-linked` and lists the PRs anyway.

Two ways out, and the second is the one taken:

- Repair the annotations, then the button works. Fixes today's plans and
  nothing about tomorrow's.
- **Teach `/plot-deliver` the scan's method** — match merged PR heads to branch
  names where annotations are absent. The button then works on any plan, and
  the annotations become a convenience rather than a precondition.

**Both halves of that were demonstrated on 2026-08-22.** Delivering the
fourteen by hand required back-filling **21 annotations** first, because
`/plot-deliver` reads only `→ #N` and several plans cited their PRs as
`(#302)` — a form the parser does not recognise. So the first way out was
walked, at exactly the cost it predicts, and it fixed nothing about the next
plan a worker forgets to annotate.

The scan needs none of this: it matches merged PR heads to branch names, which
is why its output says `PRs: none-linked` and then lists the PRs anyway. One
derivation exists and `/plot-deliver` should use it.

The annotation gap itself is a *rule without a gate*: a worker is told to
annotate and did not, in 12 of 16 cases. Making it a gate is a real fix and a
different one — recorded in Notes rather than folded in here, because a gate on
PR creation is not a change to the delivery path.

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

> **Order matters twice here.** The annotation fix comes BEFORE the button,
> because without it `/plot-deliver` refuses on any plan whose worker never
> annotated — which is most of them. The rename comes LAST and alone: it is
> mechanical but touches 54 occurrences across source and tests, so it would
> rebase-collide with every sibling branch if it went earlier.

### Reached

- `feature/merged-waves-reach-testing` → #345 — a plan whose every wave holds a merged
  branch reports the phase after Development rather than Development. Tests: all
  waves merged → the later phase; one wave open → Development; a deferred branch
  does not block it, matching the scan's own rule; a plan already `delivered`
  is untouched; the derivation is the server's and is not remade in the renderer.

### Verified

- `feature/deliver-finds-prs-without-annotations` → #350 — `/plot-deliver` matches
  merged PR heads to branch names where a plan carries no `→ #N` annotation,
  which is what `plot-reconcile-scan.sh` already does. Tests: a plan with zero
  annotations and all branches merged verifies; one with an unmerged branch
  refuses and names it; annotations, where present, still win; the host is asked
  through `plot-host.sh` and never directly.

### Offered

- `feature/the-plan-row-offers-deliver` → #351 — the plan row gains a `Deliver` action
  spawning `/plot-deliver <slug>`, wrapping the skill rather than writing the
  transition. Tests: the item appears only on a plan whose waves are all merged;
  it is absent where the server would refuse and NAMES the refusal on the
  control; the click spawns and writes nothing itself; a `delivered` plan offers
  nothing; the route refuses a non-localhost binding, like every other spawn.

### Named

- `feature/the-phase-after-development-is-testing` → #361 — `Endgame` becomes `Testing`
  through `BOARD_PHASES`, its mapping and every reader. Tests: the contract enum
  carries `Testing` and not `Endgame`; `toBoardPhase('delivered')` returns it;
  the board column header reads it; no source file under `packages/board/src`
  matches `Endgame`; the 13 plan files are handled per the Open Question above.

## Notes

Found while answering *"kannst du die plan statusse aktualisieren?"* — the
answer being that a mass edit is the wrong shape: sixteen lifecycle transitions,
each of which `/plot-deliver` exists to verify.

The operator settled the target phase and the action in one message: *"Wir
sollten die Phase Endgame nach Testing umbenennen und wenn alle WAVES eines
Planes gemerged sind müssen wir in TESTING sein. Falls das Testing gut läuft
brauchen wir eine neue Action für Plan Row 'Deliver'."*

**Interrogated 2026-08-22.** The headline number moved between writing and
review — `merged_not_delivered` 16 → 2 — and the reason is the plan's own
thesis: a person drained fourteen by hand that morning, flipping phases,
writing `Delivered:` records, moving symlinks and back-filling 21 PR
annotations. Detection had worked the whole time; only action was missing. The
motivation now argues from the recurrence rather than from a backlog that no
longer exists.

Two orderings changed. The annotation fix moves ahead of the Deliver button,
because a button that refuses on most rows is not a feature — and the manual
delivery proved the refusal is real, not theoretical. The rename moves last and
alone: measured at 17 source and 37 test occurrences of a **contract enum
value**, it would rebase-collide with every sibling branch if it went earlier,
and it is safe alone precisely because nothing persists the word — no pulse
file, no stored state, so old and new never meet.

Recorded, not folded in: gating the `→ #N` annotation at PR creation. Twelve of
sixteen workers ignored the instruction, which makes it a rule without a gate —
but a gate on PR creation is not a change to the delivery path, and this plan
should not grow one.


<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": false, "architecture": false, "implementation": false},
    "domain": {"rules": false, "workflows": false, "data": false},
    "ux": {"happyPath": false, "edgeCases": false, "errors": false, "accessibility": false},
    "nonFunctional": {"security": false, "performance": false, "scalability": false},
    "tradeOffs": false
  },
  "_note": "Back-filled 2026-08-22: this plan was interrogated once on 2026-08-22 (see ## Notes). The round count is recorded, but the questionHistory could not be reconstructed from prose after the fact, so it is left empty rather than invented."
}
END-CHALLENGE-THE-PLAN-METADATA -->
