---
'@plot-pm/board': minor
---

board: an eligible wave starts itself — the switch finally does something

Waves 1 and 2 gave the board a liveness registry (#327) and a fleet switch and
stepper (#329), but nothing read the switch: `/api/fleet` reported
`autoDispatch: true` while no code anywhere started work. This is the reader.

While the switch is on, eligible waves of approved plans dispatch with no click,
wrapping `plot-dispatch.sh` — which still owns the claim-by-ref-push, the
abandoned-desk refusal, the in-flight file report and the worktree fan-out, so
every refusal that protects a watched dispatch protects an unwatched one.

Decided and enforced:

- **The cap is a STANDING PROPERTY across pulses, not a per-fan-out argument.**
  `--max N` bounds one invocation; two pulses each passing N reach 2N. Each
  pulse the board counts what is already live — `running` plus `waiting`
  registry entries, plus branches it dispatched whose detached claim the pulse
  cannot yet see — and dispatches only `parallelAgents − live`. The sum across
  every pulse stays below the stepper, which `--max` alone cannot promise.
- **Never kill.** The control governs starting, not stopping. Lowering the
  number or flicking the switch off shrinks the next pulse's budget and touches
  no running worker; a negative budget clamps to zero. There is no kill path.
- **Only approved plans, only eligible waves.** A blocked wave, a draft plan's
  wave, and a branch already claimed do not dispatch — the last one because the
  claim ref is the one mechanism that makes it safe, and no second one is added
  beside it.
- **NOT a route.** It rides the scan timer inside `refresh`'s success path,
  beside `maybeRepair` and of the same kind: from a pulse that actually landed,
  off the request path entirely, reachable from no binding. It joins no
  `WRITE_ROUTES` list because it is not a write route.

Server-side only, in `packages/board/src/server/auto-dispatch.ts` and its wiring
in `fleet.ts`. No schema change, no client change; the switch and stepper from
#329 are untouched.
