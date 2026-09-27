## Implementation brief — a-desk-says-who-owes-it

- **Plan (canonical):** `docs/plans/2026-09-27-a-desk-says-who-owes-it.md` on `main`
- **Approved:** 2026-09-27, jwloka, in-session after panel (round 1)
- **Branch:** `bug/a-desk-says-who-owes-it` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — PR review, CI green
- **Issue:** #1030

Single-slice plan: nothing waits on this branch and it waits on nothing.

### What to build

Carry `SupervisionCause` from the supervisor's tick to the fleet payload's rows, so a person can tell a desk the fleet is about to serve from one it has given up on.

Measured 2026-09-27: `no-headroom` occurs in **three lines on the whole estate**, all in `packages/domain/src/rules/supervision.ts` (`:139`, `:202`, `:205`). A grep across `packages/board/src` returns nothing. The one consumer of the field is a `write()` to stdout at `packages/board/src/server/entry/registryd-main.ts:960`. A live `/api/fleet` is 31 KB, 22 rows, three agents, and carries **no `cause` field anywhere**.

The plan is canonical; this brief is orientation.

### Decisions the plan settles — do not re-derive them

**The seam is already cut. Extend it; do not design it.** The plan's first draft read as greenfield and the panel refuted that. Three things ship today and the slice must cite them:

- `isBrokenState` (`contract/schema.ts:3405`) — `stalled || failed || unknown`, an allowlist whose docstring already argues the exclusions.
- the placement rule (`app/lib/agent-rows/working-agents.ts:69`) — *"WORKING iff `isLiveState`, WAITING ON YOU iff `isBrokenState`"*.
- `quietKind` (`contract/schema.ts:3082`) — a five-value word carried outward for this plan's exact purpose: *"IT EXISTS SO THE STATUS WORD IS NOT DERIVED IN THE VIEW … FORWARDED, NEVER RE-DERIVED."* **This is the precedent to follow and to cite.**

**Take shape (2): a sibling field forwarded like `quietKind`.** The plan names three candidate shapes. Default to carrying the cause as its own field. Do NOT make it an input to `isBrokenState` and do NOT move any row between sections — see the next decision.

**MOVE NO ROW. The misplacement was never observed.** The plan's first draft asserted a deferred desk renders `group: waiting-on-you, state: wip, worker: none`. Measured, that is false three ways: group distribution is `{"waiting-on-you":1,"done":21}` and the single row is `changeset-release/main` (a Changesets PR, no plan, no desk); two branches the log records as `defer (no-headroom)` both resolve `group=done state=merged worker=elsewhere`; and `worker` is a **string** whose measured values are `{"elsewhere":19,"finished":3}` — `none` appears zero times. A `no-headroom` desk cannot reach WAITING ON YOU by today's code even in principle, because placement reads the registry's `AgentState` and `no-headroom` is not one of the eight. **If you find yourself hunting a placement bug, stop: there isn't one.**

**The mapping is in the plan, not yours to invent.** Nine causes, and the plan's table says which owe a person. Put that table in the code as the rule. Measured across both registry logs, only **three** causes have ever been emitted — `no-progress` (1200), `no-headroom` (1122), `budget-spent` (498) — and `gates-passed`, `gates-failed`, `declaration-absent`, `declaration-unreadable`, `agent-blocked` have **zero** occurrences. `worker-alive` cannot appear at all: `registryd-main.ts:958` filters `verdict === 'leave'` before printing.

**`no-progress` is the contested entry and it is 60% of all emissions.** The plan's table says: not a person's, until the budget is spent, at which point `budget-spent` is the transition. If you disagree, say so in the PR and change the table explicitly — do not quietly re-open it.

**Carry all nine.** The measured range is three; a narrowed type would refuse a cause the supervisor can legitimately produce. Say so rather than reasoning as though all nine are live.

**No second derivation.** The cause is computed each tick and typed. Carry it: tick → registry → fleet payload → row. A second computation anywhere is the defect this fixes, reproduced.

**Out of scope, by the plan's own list:** what the fleet recovers (measured: it restarts a died worker and defers correctly — #1027's original claim was refuted); any controller verb; the reaper (#1015, #1024).

**Do not use the escape ledger as this plan's cost.** 18 of 24 rows in `.plot/state/unowned-action-writes.tsv` name a blocked `/api/dispatch`, which is #1027's and #1018's territory. The motivation was amended to stop claiming it.

**Rules carried over:** a board capability needs its schema field or the client cast drops it; the client casts the fleet payload rather than parsing it, so a new field is `undefined` in the renderer until the schema carries it.

### Done when

The plan's `## Done when` list is the specification. Assertions a naive implementation passes without:

- **A test asserts ONE producer.** The cause in the row must be the tick's value, not a value recomputed in the board. A test that only checks the field is non-empty passes on a re-derivation.
- **The mapping table is in code with its argument**, and a test names `no-progress`'s entry explicitly — it decides almost every row.
- **No row changes section.** Assert that the group distribution is unchanged by this slice against a fixture holding a deferred desk.
- **A desk deferred on headroom shows its reason** on the row, read from the tick.
