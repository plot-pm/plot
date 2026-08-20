# Brief — bug/an-agent-is-not-a-machine-you-wait-on

Wave 1 of `docs/plans/2026-08-20-every-section-has-one-subject.md`. Read the plan;
this brief names what to touch and what the traps are.

**One rule, categorical: no worker state may put a row in WAITING ON A MACHINE.**
That section is for a build or a pipeline. An agent is the machine, not the wait.

## The membership rule is in the CLIENT

This is the part the plan's first draft got wrong, so it is stated plainly.

`AgentList.tsx:230` (line number will have moved — find it by name):

    export function inMachineSection(row: AgentRow): boolean {
      return row.group === 'waiting-on-machine' || processesOf(row).length > 0;
    }

The section is **additive to the group**: the left half is the server's grouping,
the right half admits any row carrying a `processes` entry. `machineProcesses`
(`fleet.ts`, find `origin: 'local'`) writes one for every running worker — so a
row can be `group: 'working'` **and** render in the machine section. Measured:
`/api/fleet` reported `group: working` for a row the tab showed twice.

`fleet.ts` builds the **description**; `AgentList.tsx` decides **membership**.
Both change here, but do not go looking for the grouping in the server.

## What to do

1. **`machineProcesses` loses its `origin: 'local'` half.** Keep the host half
   verbatim — its `pending`-only reading through `prState` is load-bearing and
   documented where it sits.
2. **`inMachineSection` stops admitting rows on worker state.** With no local
   origin, `processes` carries only host entries, which the server has already
   grouped — so the `||` is redundant. Whether it collapses to
   `row.group === 'waiting-on-machine'` or still reads `processes` for host
   entries is yours; what must hold is that **no worker state can reach this
   section**.

## The objection that was measured and refuted

An earlier reading declined this because *"an agent that exited while its checks
still run would land nowhere."* It lands there by **two paths that never look at a
worker**:

- `fleet.ts:2501` — `pr.checks === 'pending'` sets `group: 'waiting-on-machine'`
- `machineProcesses`' host half — `prState(pr) === 'pending'` pushes `origin: 'host'`

So removal loses no row. If you find a case where it does, that is a discovery to
report — it would mean one of those two paths does not do what was measured.

## Out of scope

- **WORKING.** It already lists a running worker and nothing about it moves here.
  Making WORKING agent-centred is wave 3 (`feature/working-is-about-agents`) and
  is a much larger change — do not start it.
- **The `processes` field itself.** It stays on the row; other things read it.
  This removes the local **entry**, not the field.
- **The CI grouping** at `fleet.ts:2501`. Untouched.
- **Agents in WAITING ON YOU.** That is wave 2. A crashed agent does not become
  visible through this branch, and that is correct for now.

## Tests the plan requires

- a running worker with **no PR** appears in WORKING only
- a running worker with a **pending** check appears in WORKING, **and the PR's row
  is in WAITING ON A MACHINE — the agent is not**
- a **stopped** worker with a pending check is still listed, which is the case the
  local origin was wrongly credited with covering
- **no worker state of any kind** — `running`, `waiting`, `stalled`, `finished`,
  `failed`, `ended`, `none`, `elsewhere` — puts a row in the machine section
- `processes` still carries host entries
- the CI grouping at `fleet.ts:2501` is unchanged
- no other section's membership moves

The fourth is the one that makes this a rule rather than a patch: assert it over
the whole enum, not over the two states that happen to occur today.

## While you work

`AgentList.tsx` is being rewritten in parallel by
`bug/one-component-renders-every-row` — roughly 1200 lines deleted. Verified:
`inMachineSection` survives that change unaltered (it only moves). But:

- **Push your first real commit as soon as it exists.**
- **After that branch merges, rebase and re-check the call site** — the code that
  calls `inMachineSection` (search for `waiting-on-machine` in the section
  filter) sits inside the region being rewritten.

Run the touched test files rather than the full suite; the suite is ~8 minutes and
CI runs it anyway.
