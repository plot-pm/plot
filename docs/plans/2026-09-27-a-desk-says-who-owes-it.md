# A desk says who owes it

> A desk with no live worker has three causes and one appearance, so an operator intervenes where the fleet would have acted. Measured 2026-09-27: **eleven claim refs cleared by hand in one session**, and of two desks that looked stalled, the fleet had already restarted one and legitimately deferred the other. The supervisor computes the reason every tick — `supervision.ts:139` types nine of them — and discards it after printing.

## Status

- **State:** Released
- **Released:** 2026-09-28, 2.21.0
- **Approved:** 2026-09-27, jwloka, in-session
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1030
- **Sprint:** plot-works-in-the-repos-that-adopt-it
- **Rounds:** 1
- **Started:** 2026-09-27, fleet agent free-d1b5cabb, `bug/a-desk-says-who-owes-it`
- **Delivered:** 2026-09-28

## Changelog

- A desk says why it has no worker: deferred on headroom, being restarted, or genuinely stuck. The reason reaches the row, so a person can tell a desk the fleet is about to serve from one it has given up on. **Section placement is unchanged** — the rule naming which causes owe a person ships with no reader, and a row moves only once a payload reading shows one misplaced.

Board impact: **yes.** The supervision cause reaches the fleet payload and the row. No new derivation — the value already exists.

## Motivation

**Three causes, one appearance.**

```
deferred on headroom        → the fleet will start it. Do nothing.
worker died                 → the fleet will restart it. Do nothing.
never started, not deferred → needs a person.
```

All three look the same: a desk, a claim, no live pid.

### The supervisor knows and the board does not

```
plot-registryd tick agents=3 ... defer=1 ... no-free-agent=0
  infra/a-decision-reads-rather-than-asks: defer (no-headroom)
```

Measured 2026-09-27, `/api/fleet` on the live board: **31,240 bytes, 22 rows, three agents, and no `cause` field anywhere** — not on a row, not on an agent. A row's whole worker field is one word:

```json
{"branch":"infra/a-decision-reads-rather-than-asks",
 "worktree":".../.worktrees/free-83d3325b","state":"stalled","worker":"elsewhere"}
```

`no-headroom` appears in **three lines on the whole estate**, all inside `packages/domain/src/rules/supervision.ts` (`:139`, `:202`, `:205`). A grep across `packages/board/src` returns nothing. The one consumer of the field is a `write()` to stdout at `packages/board/src/server/entry/registryd-main.ts:960`.

**The cause is computed every tick and discarded after printing.** That is the defect.

### What the symptom is NOT

An earlier draft of this plan asserted that the deferred desk's row reads `group: waiting-on-you, state: wip, worker: none`. **Measured, that is false in three ways** and the correction matters because a builder would hunt a placement bug that does not exist:

- Group distribution is `{"waiting-on-you":1,"done":21}`. The one `waiting-on-you` row is `changeset-release/main` — a Changesets release PR with no plan, no desk and no agent.
- Two branches the log itself records as `defer (no-headroom)` resolve to `group=done state=merged worker=elsewhere`. Neither is in WAITING ON YOU.
- `worker` is a string, and its measured values are `{"elsewhere":19,"finished":3}`. `none` appears zero times.

A `no-headroom` desk **cannot** reach WAITING ON YOU by today's code even in principle: placement reads the registry's `AgentState`, `no-headroom` is not one of the eight, and the only state routing there is `stalled` — a TREE reading, not a headroom one.

**So the misplacement was inferred from operator behaviour and never observed in a payload.** What is measured is the absent field; the section consequence is a hypothesis this plan does not need.

### What it cost, and what the record actually attributes it to

`.plot/state/unowned-action-writes.tsv` holds 24 rows, all `dispatch`, dated 9 / 11 / 4 across 09-25 / 09-26 / 09-27 — **so no single session holds 15**, as an earlier draft claimed.

More importantly, **18 of the 24 name a blocked endpoint rather than an unreadable cause**:

```
18  board /api/dispatch blocks its event loop under scan load
 1  --restart has no controller endpoint
 1  three agents hold desks on branches whose PRs merged (#1004, #1014, #1007)
 1  two desks handed slices but no worker runs: one exit=124, one never wrote a log
 1  two PRs red with dead agents
 2  a marker cleared after a dependency shipped
```

That is #1027's and #1015's territory, which this plan excludes. **The escape ledger does not size this defect**, and the motivation no longer claims it does.

What remains measured and attributable: of two desks that looked stalled on 2026-09-27, **the fleet had already restarted one** — running 20 minutes, predating the operator's attempt by sixteen — and **deferred the other on the machine bound**, which is `rules/fleet-size.ts` working. Neither needed a person, and nothing on the board said so. That is the cost: a person cannot tell a desk the fleet is about to serve from one it has given up on.

### The value exists and is typed

`supervision.ts:130` already declares nine causes:

```ts
export type SupervisionCause =
  | 'worker-alive' | 'gates-passed' | 'gates-failed'
  | 'declaration-absent' | 'declaration-unreadable' | 'agent-blocked'
  | 'budget-spent' | 'no-progress' | 'no-headroom';
```

And its docstring states the intent this plan completes: *"The correction and the resume handle travel WITH the verdict rather than being re-derived by the caller."* The cause travels with the verdict as far as the tick's stdout, and no further.

## Design

### The rule

**A row carries the supervision cause for its desk, and WAITING ON YOU admits only the desks that owe a person.**

A desk deferred on headroom, or whose worker the fleet is restarting, is the fleet's to answer. It belongs in WORKING or a queue, not in the section that means *go look at this*.

### The seam is already cut, and this extends it rather than designing it

An earlier draft read as greenfield design. **Three mechanisms ship today and the slice must build on them, not beside them:**

| what exists | where | what it already does |
|---|---|---|
| `isBrokenState` | `contract/schema.ts:3405` | `stalled \|\| failed \|\| unknown` — an allowlist, with the exclusions this plan wants already argued in its docstring |
| the placement rule | `app/lib/agent-rows/working-agents.ts:69` | *"WORKING iff `isLiveState`, WAITING ON YOU iff `isBrokenState`"* — four states appear in neither |
| `quietKind` | `contract/schema.ts:3082` | a five-value word carried outward for this plan's exact stated reason: *"IT EXISTS SO THE STATUS WORD IS NOT DERIVED IN THE VIEW … FORWARDED, NEVER RE-DERIVED"* |

`quietKind` is the precedent to follow, and the slice must say **which of three shapes** the cause takes, because they are three different diffs:

1. a sixth `quietKind` value,
2. a sibling field forwarded the same way, or
3. an input to `isBrokenState`.

**Only the third changes placement.** Given that the payload misplacement was never observed (see *What the symptom is NOT*), the slice should default to **(2)** — carry the cause so a person can read it — and treat any placement change as a separate, evidenced decision.

### No new derivation

The cause is computed each tick and typed. This carries it: tick → registry → fleet payload → row. **A second computation anywhere is the defect this fixes, reproduced.** `quietKind`'s docstring is the rule to cite.

### The mapping, stated here rather than deferred to the slice

A design whose whole behaviour is one table carries the table. Measured across both registry logs, **only three of the nine causes have ever been emitted**:

```
defer (no-progress)             1200
defer (no-headroom)             1122
needs-a-person (budget-spent)    498
```

`gates-passed`, `gates-failed`, `declaration-absent`, `declaration-unreadable` and `agent-blocked`: **zero occurrences.** `worker-alive` cannot appear — `registryd-main.ts:958` filters `verdict === 'leave'` before printing.

| cause | owes a person? | why |
|---|---|---|
| `budget-spent` | **yes** | the correction budget is exhausted; nothing automatic remains |
| `agent-blocked` | **yes** | a `PLOT-BLOCKED` marker is a question addressed to a person |
| `declaration-absent` | **yes** | an agent the registry cannot read is a broken installation |
| `declaration-unreadable` | **yes** | as above |
| `no-headroom` | **no** | `rules/fleet-size.ts` working; the machine will serve it |
| `worker-alive` | **no** | nothing is wrong and it never reaches the report |
| `gates-passed` | **no** | the desk is finishing |
| `gates-failed` | **no** | the tick hands a correction |
| `no-progress` | **no, until the budget is spent** | it is what the fleet restarts on, and `budget-spent` is the transition to a person |

**`no-progress` is 60% of all emissions**, so the one contested entry decides almost every row. The slice must not re-open it silently: if the argument above is wrong, say so and change this table.

Carrying a nine-value field whose measured range is three is correct — the six that never fire cost nothing and a narrowed type would refuse a cause the supervisor can legitimately produce.

### What this does NOT do

- **It does not change what the fleet recovers.** Measured: the fleet restarts a died worker and defers correctly. #1027 claimed otherwise and was corrected. This is what an operator sees, not what the fleet does.
- **It does not add a controller verb.** Whether `restart` and `release` should exist is #1027's question and is not answered here.
- **It does not change the reaper.** #1015 and #1024 are about desks that cannot be cleaned up; this is about desks that need nothing.
- **It does not move any row on today's evidence.** The payload measurement found no misplaced row, so a placement change needs its own reading first.

## Done when

- A desk deferred on headroom shows that reason on its row, read from the tick and not re-derived.
- The cause reaches the payload for every desk the tick judged, and a test asserts one producer.
- The mapping table above is in the code as the rule, with its argument, and `no-progress`'s entry is the one a test names explicitly.
- `quietKind`, `isBrokenState` and `working-agents.ts` are cited by the slice, and the chosen shape of the three is stated.
- No row changes section without a payload reading that shows it misplaced.

## Slices

### A desk says who owes it (Branch: bug/a-desk-says-who-owes-it, PR: #1034)

Carry `SupervisionCause` to the row, state the mapping, and place the sections by it. One slice: the value exists, the transport is the work, and splitting transport from placement would ship a field nothing reads.

## Notes

This plan exists because its absence was measured in code: `no-headroom` occurs in three lines of one domain file, has no reader in `packages/board/src`, and a 31 KB `/api/fleet` payload carries no `cause` field at all.

**Amended after round 1 (2026-09-27).** The evidence lens committed `amend` having executed, and three of its findings changed this plan:

- **The central claim was ACQUITTED, not refuted** — stronger evidence than the plan originally offered.
- **The symptom was refuted.** The quoted `group: waiting-on-you` payload is not reproducible; `worker: none` is not a value the field takes. Replaced with the real reading, and the placement change is now gated on evidence that does not yet exist.
- **The cost was misattributed.** 18 of 24 escapes name a blocked `/api/dispatch`, and no single session holds 15. The motivation no longer claims the ledger sizes this defect.
- **Two shipped mechanisms were unnamed.** `quietKind` and `isBrokenState` each carry a docstring making this plan's own argument, already merged. The Design now extends them and names which of three shapes the cause takes.
- **The mapping moved into the plan** from the slice, with the measurement that only three of nine causes ever fire and `no-progress` is 60% of them.

Verdict and full reading: `.plot/panels/2026-09-27-a-desk-says-who-owes-it/evidence.md`.

**Three sibling issues share the theme and are deliberately not folded in**: #1027 (a dispatch returns before a worker exists), #1015 (a finished worker can be neither stopped nor reaped), #1024 (three reaper refusals compose). Each needs its own evidence, and one plan spanning four would produce slices colliding on the same files.
