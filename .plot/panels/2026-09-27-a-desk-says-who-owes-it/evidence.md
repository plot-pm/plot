# Evidence lens — a desk says who owes it

Position: amend
Evidence: executed

## 1. Is the defect real? What did I measure?

**The core defect is real and I confirmed it three ways.**

`no-headroom` exists in exactly THREE lines on the whole estate, all inside one file:

```
packages/domain/src/rules/supervision.ts:139:  | 'no-headroom';
packages/domain/src/rules/supervision.ts:202:): Extract<SupervisionCause, 'budget-spent' | 'no-progress' | 'no-headroom'> | null => {
packages/domain/src/rules/supervision.ts:205:  if (readings.headroom !== 'clear') return 'no-headroom';
```

A `grep` for the word across `packages/board/src` returns nothing. The board cannot name this cause because the string does not appear in it.

`grep -rn "\bcause\b" packages/board/src` finds ONE consumer of the field, and it is a `write()` to stdout:

```
packages/board/src/server/entry/registryd-main.ts:960:
    write(`  ${row.branch}: ${row.supervision.verdict} (${row.supervision.cause})\n`);
```

The live payload agrees. `curl localhost:7777/api/fleet` returned 31,242 bytes with three agents, and **no agent or row carries any cause field**:

```json
{"session":"","identity":"synthesized","attempts":0,
 "branch":"infra/a-decision-reads-rather-than-asks",
 "worktree":".../.worktrees/free-83d3325b","state":"stalled"}
```

That is the whole entry. `verdict`, `cause`, `failures`, `nextAttempts` — none of them travel. **The plan's central claim survives the evidence lens: the cause is computed every tick and discarded after printing.** That is the one thing today's panels usually refute, and here it holds.

The tick does name a cause per desk, and I saw both shapes. `.plot/logs/registryd.log` holds **367 defer lines naming a branch** and **67 naming none** (the empty-branch form `  : defer (no-headroom)`, which is what the plan quotes at line 37 — it quotes the *nameless* variant as its evidence that the supervisor knows which desk, which is a small own-goal but not the defect).

## 2. Does the design work, or is it already built?

**Half of it is already built, and the plan does not know.** This is the amendment.

`packages/board/src/app/lib/agent-rows/working-agents.ts` ALREADY decides which desks reach WAITING ON YOU, by an explicit rule with its argument written out at `:69`:

> "An entry reaches WORKING iff `isLiveState` is true, and WAITING ON YOU iff `isBrokenState` is true. Four states are neither — `finished`, `ended`, `none` and `elsewhere` — so they appear in neither section."

`isBrokenState` (schema.ts:3405) is `stalled || failed || unknown`, an allowlist, and its docstring already argues the exclusions the plan proposes to argue:

> "NEITHER ARE `ended`, `none` AND `elsewhere` … an agent with no process is not a problem report. Filing them in WAITING ON YOU would put a row in front of a person for every agent that has ever finished and been forgotten."

And `quietKind` (schema.ts:3082) is a five-value field — `merged · closed-pr · orphaned-claim · abandoned · quiet` — that exists for the plan's exact stated purpose, with the plan's exact argument:

> "IT EXISTS SO THE STATUS WORD IS NOT DERIVED IN THE VIEW … FORWARDED, NEVER RE-DERIVED."

So the *rule* ("WAITING ON YOU admits only desks that owe a person"), the *placement mechanism*, and the *precedent for carrying a cause-like word outward* all ship today. What is missing is only the `SupervisionCause` value itself. **The plan reads as greenfield design for a seam that is already cut**, and its Design section names neither `isBrokenState`, `quietKind`, nor `working-agents.ts`.

## 3. What does the plan claim that a measurement contradicts?

**Claim A — refuted. "The row sits in WAITING ON YOU" for a desk deferred on headroom.**

The plan's Motivation block (lines 40-49) asserts a specific payload for a deferred desk: `group: waiting-on-you`, `state: wip`, `worker: none`.

The live payload has **exactly one** `waiting-on-you` row out of 22:

```
group distribution: {"waiting-on-you":1,"done":21}
```

and it is `changeset-release/main` — a Changesets release PR, no plan, no desk, no agent. I then took two branches the log itself records as `defer (no-headroom)` and looked them up:

```
infra/a-brief-is-named-by-the-rule      -> group=done state=merged worker=elsewhere
feature/the-board-filters-to-my-work    -> group=done state=merged worker=elsewhere
```

Both in DONE. Neither in WAITING ON YOU.

Two further contradictions in that same quoted block: `worker` is a **string**, not an object, and its measured values are `{"elsewhere":19,"finished":3}` — `none` appears zero times in this payload. And a `no-headroom` desk **cannot** be routed to WAITING ON YOU by today's code even in principle: placement reads the registry's `AgentState`, `no-headroom` is not one of the eight states, `plot-worker-state.sh` contains no mention of headroom, and the only state that would route there is `stalled` — which is a *tree* reading, not a headroom one.

So the mechanism the plan infers from the symptom is wrong. There may well be a desk somewhere that looks stuck and is merely deferred, but **the route by which it gets into WAITING ON YOU is not the one the plan describes**, and a builder following this design would look for a bug in section placement that placement does not have.

**Claim B — unsupported by the file the plan cites. "Eleven interventions, an unknown share unnecessary."**

The escape counts check out exactly: `.plot/state/unowned-action-writes.tsv` has 24 rows, all `dispatch`. But the plan's inference — that these were operators clearing desks they misread as stuck — is contradicted by the reasons recorded in column 4:

```
13  board /api/dispatch blocks its event loop under scan load
 4  board /api/dispatch blocked its own event loop under scan load
 1  --restart has no controller endpoint
 1  three agents hold desks on branches whose PRs merged (#1004, #1014, #1007)
 1  two desks handed slices but no worker runs: one exit=124, one never wrote a log
 1  two PRs red with dead agents
```

**17 of 24 — and 17 of the plan's own "15 of them were that session" — say the controller endpoint was unusable, not that a desk's cause was unreadable.** That is issue #1027's territory, which the plan explicitly excludes at line 93. Also: the plan says "15 of them were that session"; the date column reads 9 / 11 / 4 across 09-25 / 09-26 / 09-27, so no single date holds 15.

The cost argument is therefore attributing to a *missing cause field* a cost the record attributes to a *blocked dispatch endpoint*. The defect is real; this evidence does not size it.

**Claim C — the mapping is thinner than nine.** The plan's Design (line 86) reasons over all nine causes. Measured across both logs, only **three** have ever been emitted:

```
registryd.log:             defer (no-progress) 659   defer (no-headroom) 434
registryd.log.2026-09-21:  defer (no-headroom) 688   defer (no-progress) 541
                           needs-a-person (budget-spent) 498
```

`gates-passed`, `gates-failed`, `declaration-absent`, `declaration-unreadable`, `agent-blocked` and `worker-alive`: **zero occurrences in any log.** (`worker-alive` cannot appear — `reportTick` does `if (row.supervision.verdict === 'leave') continue;` at registryd-main.ts:958, so it is filtered before printing. My own `--once` run printed `agents=2 left=2 … defer=0` and no per-agent line at all, which is that filter working.) The plan's hardest sentence — "`no-progress` is the open one" — lands on the cause that is **60% of all emissions**, so the mapping's one genuinely contested entry is also its most load-bearing, and the plan defers it to the slice.

## 4. What must the plan say before someone builds it?

1. **Drop or re-measure the `group: waiting-on-you` payload block (lines 40-49).** It is not reproducible against the live board. Replace it with a real reading, or state plainly that the misplacement was inferred from operator behaviour and not observed in a payload — the Notes section already says as much, honestly, and the Motivation contradicts it by quoting a payload as if measured.
2. **Name `isBrokenState`, `working-agents.ts` and `quietKind`.** Say whether the cause becomes a sixth `quietKind` value, a sibling field forwarded the same way, or an input to `isBrokenState`. Those are three different diffs and the "Done when" list does not distinguish them. `quietKind`'s docstring is the precedent to follow and the plan should cite it.
3. **Separate the cost.** 17 of 24 escapes name a blocked `/api/dispatch`. Either re-derive the cost of *this* defect from evidence that isolates it, or make the motivation qualitative and stop claiming eleven interventions as this plan's measured cost.
4. **State the mapping in the plan, not in the slice.** Line 88 says the slice states it. Three causes ship in practice and `no-progress` is 60% of them; the entry the plan calls "the open one" is the one that decides almost every row. A design whose whole behaviour is one table should carry the table.
5. **Say what happens to the six causes that never fire.** Carrying a nine-value field whose measured range is three is fine, but the plan should say so rather than reasoning as though all nine are live.

## 5. What did executing reveal that reading would not?

Reading the plan, its central claim looks like its weakest point — "the cause is discarded" is exactly the shape of an inferred mechanism. **Executing acquitted it.** The three-line grep for `no-headroom` and the 31 KB payload with no cause field are stronger evidence than the plan itself offers, and no amount of re-reading the plan would have produced them.

What executing refuted instead was the *symptom*, which reading would have accepted. `group distribution: {"waiting-on-you":1,"done":21}` took one curl, and it inverts the Motivation: the section the plan says is polluted holds one row, and that row is a Changesets PR with no desk at all. A reader would have taken the quoted payload block at face value — it is formatted as a measurement.

Executing also surfaced what reading could not reach: `worker` is a string whose values are `elsewhere` and `finished`, so the plan's `worker: none` line is not a field that exists; and the log's own `defer` lines split 367 named / 67 nameless, with the plan quoting the nameless form as proof the supervisor knows which desk.

And the `grep` that mattered most was the one for prior art. `quietKind` and `isBrokenState` each carry a docstring making the plan's own argument, in the plan's own register, already merged. Reading the plan gives no hint they exist — which is how a plan comes to propose a seam that was cut three weeks ago.

**Position: amend.** The defect is real, better evidenced than the plan claims, and worth fixing. The transport design is sound. But the symptom is misdescribed, the cost is misattributed by a factor the record contradicts, and the plan is blind to the two shipped mechanisms it should be extending. A builder handed this as written would hunt a placement bug that does not exist and rebuild a seam that does.
