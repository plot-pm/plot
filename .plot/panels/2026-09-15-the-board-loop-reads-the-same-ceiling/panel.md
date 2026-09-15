# Panel — the-board-loop-reads-the-same-ceiling

Subject: `docs/plans/2026-09-15-the-board-loop-reads-the-same-ceiling.md` (Draft)
Lenses: premise, regression, layering. Reconciliation: **unanimous — amend**.

## The premise survives — the first on this subject that does

**Six plans this week rested on a false premise. This is not one of them.**

All three jurors verified independently: `ceilingFor` exists at
`fleet-size.ts:165` and is **module-private** (`index.ts:58`'s `export *` cannot
reach a private const); `TIGHT_CEILING = 2` (`:99`), `STARVED_CEILING = 1`
(`:88`); `clear` and `unmeasured` both fall through to `Infinity` (`:166-170`);
`auto-dispatch.ts` imports **nothing** from `fleet-size.ts` — the only importer
on the estate is `workflows/assign.ts:2`. Supervisor `DESKS_PER_TICK = 3`
(`registryd-main.ts:482`) and `TICK_INTERVAL_MS = 60_000` (`registryd.ts:52`).

**One citation slip:** the budget line is `auto-dispatch.ts:478`, not `:479`
(`:479` is blank). Cosmetic, and named because it is the plan's load-bearing
citation. **Third document this week whose stated figure is off by a hair.**

## The "cannot latch" claim is CORRECT, and the data proves it

**`regression` was asked to test the claim against the measurements rather than
the logic, because the rejected sibling died exactly here.** Its answer is the
strongest thing in this panel:

> *"'It is a pure function of one reading' is true but insufficient — a pure
> function can still pin a system if the quantity it bounds is absolute. What
> actually saves it is that **the bounded quantity is a difference, not a
> level**."*

On a permanently-tight board, a ceiling of 2 per 5-second pulse is a **ramp rate
of 24 agents/minute**: the fleet reaches `parallelAgents = 3` in **two pulses**,
ten seconds; six in three pulses. **No plausible cap makes it binding.**

**The rejected sibling gated on a reset event that never occurred; this gates on
a shortfall that shrinks to zero on its own.** There is no reset condition to
fail to fire. The latch pinned at **stopped**; this converges to the cap in ≤3
pulses. **The plan's claim is right and its stated reason is incomplete** — the
argument to carry is the difference-not-a-level one, not "pure function".

## The decisive defect: one gate is unsatisfiable

**`regression`'s finding, verified by the moderator.**

The `Done when` requires *"a `starved` reading still permits one dispatch rather
than zero, pinned explicitly."*

**The board already dispatches zero on `starved`, before the budget line runs.**
`machineDefers` (`auto-dispatch.ts:411-419`) returns a deferral when
`dispatchDefers(machine)`, and that is `headroom === 'starved'`
(`machine.ts:115`). The loop returns at `:476`; the budget is computed at `:478`.

**So `STARVED_CEILING = 1` is unreachable from this caller** — except under
`controls.machineOverride`, which is the operator saying *now anyway*.

The plan demands a gate that cannot pass as written, and the demand comes from
importing the supervisor's rule without checking which half of it this caller can
reach.

## The export is the right shape, for a reason the plan does not give

**`layering` was asked whether promoting a private helper for one caller is
sound, and whether the board should call `fleetSize` instead. It says the plan is
right and its own framing is wrong.**

**The board must not call `fleetSize`.** That takes
`FleetSizeReadings {requested, running, spawnCostMs, headroom}` — and a board
calling it would have to **lie about two of its inputs**, because it holds no
`requested` and no `running` in the shape the rule means.

**`ceilingFor` is a rule in its own right, not a private helper.** It reads only
`headroom` and answers only a ceiling; it is private *by history*, not by design.
So the export is not a private being promoted for convenience — it is a rule
gaining its first legitimate second caller.

## What the lenses had in common

**All three verified the code and none questioned the incident attribution** —
which this plan already refuses to claim: *"It does not claim the board caused
the 2026-09-15 incident."* That refusal is what makes this plan survivable where
its predecessor was not, and no juror tested it because the plan conceded it
first.

## What this panel asks for

1. **Drop or re-scope the `starved` gate.** It cannot pass from this caller.
   Either pin that the board's existing `starved` behaviour is unchanged — which
   is the true statement — or pin `STARVED_CEILING` only under
   `machineOverride`, which is the one path that reaches it.
2. **Carry the real argument for "cannot latch":** the bounded quantity is a
   **difference** that shrinks to zero as agents come up, not a level. The
   measured ramp is 24 agents/minute.
3. **Fix the citation** — `:478`.
4. **State why the board cannot call `fleetSize`**: it holds neither `requested`
   nor `running` in the shape that rule means, so the export is the only honest
   route.

**Amend and ship.** No juror disputes the defect, the mechanism, or the export.
The plan asks for one gate the code cannot give and states its best argument
weakly; both are wording.
