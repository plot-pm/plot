# Estate lens — the board updates an index

Position: reject

Evidence: read. Board not reproduced under a partial scan; every claim below is
read from source at the cited line on `main` at 2637e068.

## 1. The premise is false: the accumulation already exists, server-side, since #242

The plan's whole diagnosis rests on *"the client replaces its whole fleet with
every payload, so a row absent from one arrival is erased from the screen"*
(line 3) and *"there is nowhere that what is known is distinct from what just
arrived"* (line 23).

`App.tsx:283` does replace the fleet. That is true and it is not the defect,
because **a partial arrival never omits a known row.** The server composes
before it serves.

`packages/board/src/server/fleet.ts:3242-3256`, `publishPartial`:

```
const spoken = new Set(arrived.map((p) => p.file));
const plans = [...previous.filter((p) => !spoken.has(p.file)), ...arrived];
```

`previous` is `entry.pulse?.plans ?? []` (`:3224`) — the last answer, held for
exactly as long as this scan is partial. Its own comment (`:3229-3234`) states
the plan's motivation verbatim, four months earlier:

> The composition is the reason a streaming board does not flicker: at line one
> the tab would otherwise drop 23 of 24 plans and grow them back, which reads as
> the board losing the fleet rather than refreshing it. Plans this scan has
> spoken about win; plans it has not reached yet stay as they were.

This shipped in **PR #242, "The board renders what has arrived"** (`git log -S
publishPartial`). So the index-by-branch merge the plan's first slice proposes is
the index-by-plan-file merge the server already performs — one layer lower, where
`entry` is the only long-lived state and the client is a pure renderer of it.

**A client-side index would be a second accumulator over an already-accumulated
stream.** Two merge rules over one document is the drift shape this repo
repeatedly refuses.

## 2. "It has zero readers in packages/board/src/app/" is false

Plan line 37 states this flatly and builds the "the server says incomplete, the
client renders it as whole" argument on it.

`packages/board/src/app/components/AgentList.tsx:2206`:

```
{!fleet.complete && ' so far'} · scanned{' '}
```

One reader, and it is the deliberate one. `:2195-2205` argues exactly why the
total is qualified and the rows are not:

> The rows themselves are NOT qualified: each one is fully derived from its plan
> and its refs, and is exactly as true now as it will be when the scan ends. Only
> the TOTAL is provisional, so only the total says so.

`grep -rn 'fleet\.complete' packages/board/src/app/` returns exactly that one
line. The plan's claim is refuted by grep, and the comment it would have found
is a considered answer to the plan's own question.

## 3. The "complete-gated removal" the plan proposes is already wrong at the source

Plan line 133: *"`complete: true` means the scan reached its terminal line, so a
branch the index holds and the payload omits is genuinely gone — reap it."*

The server already decided this question and decided it the other way, with a
measurement. `fleet.ts:3321-3332`, on the success path:

> A scan that exits 0 and describes fewer plans is accepted — it may be right,
> and a view that cannot shrink keeps dead rows forever — but it is MARKED, so
> the tab degrades rather than hiding.

That is `entry.shrink`/`pulseShrink`. A complete pulse that lost rows is already
detected and **reported**, not silently reaped. The plan's rule would replace a
report with a deletion, on the same input, with no argument against the existing
one — and it never cites `pulseShrink` at all.

## 4. #999 already built this index, and the plan does not know it

The plan's table (line 66) lists #999 as *"a stale scan re-derives sections —
server — shipped"* and treats this plan as the untouched third route. It is not a
different route; it is the same memory.

#999 added **`CacheEntry.sections: Map<string, WaitingGroup>`** (`fleet.ts:542`),
written on every successful scan and read on every failed one
(`fleet.ts:7663-7684`). Keyed by `sectionKey(row)` =
`` `${row.repo}/${row.branch}/${row.plan ?? ''}` `` (`contract/schema.ts:3193`).

The plan proposes (line 76) keying by `branch`. **`sectionKey` already includes
the branch and is strictly better** — `fleet.ts:7677-7679` records why a bare
name collides:

> A stale key would hand its section to a future row that happened to reuse the
> name — the `repo/branch` collision one level down, one pulse later.

So the plan's key is a regression against a key the estate chose deliberately
last night, and the plan proposes it without naming `sectionKey`.

The plan's *"a held row keeps its section"* (line 141) is `sectionUnderFailure`
(`fleet.ts:6048-6058`), shipped. The plan's *"absence is not a section"* (line
127) is that function's own `null IS NOT A SECTION AND MUST NOT BECOME ONE`
(`:6031`). The plan's unplaced rendering is `AgentList.tsx:2160-2171`,
`data-unplaced`, shipped. **Four of the first slice's five deliverables exist.**

## 5. The measured symptom has a candidate explanation the plan never tests

Two agents in WORKING, neither slice rendered, both returned later. The plan
concludes the rows were received and then destroyed by a successful partial.

`freshCacheEntry()` (`fleet.ts:3486-3492`) sets `sections: new Map()`, with:

> A restart therefore remembers no section, so every row is unplaced until one
> completes.

And `fleet.ts:3492`'s sibling gate: on a **failed** scan after a restart, every
row has no remembered section, so every row goes to the unplaced list — not to
WAITING ON A MACHINE, not to NOT STARTED. That is a section-less render of
received rows, and it matches the report ("NOT STARTED read `none`") at least as
well as erasure does. The plan's own Notes say the board was restarted that
session for the `PLOT_SCRIPTS_DIR` fault (#995 notes). **The plan does not check
whether the two missing rows were in the unplaced block**, which is one glance at
`[data-unplaced]` and would discriminate the two explanations.

The plan is right that the failure path is innocent. It does not follow that a
successful payload was guilty: #999 landed hours before the measurement and
introduced a third state — received, kept, and deliberately sectionless.

## 6. Slice 3 contradicts the layering rule and the plan half-knows it

*"the index is not a render cache… where a paid-for answer lands so that the
fleet, the registry, the supervisor and the board all read one copy"* (line 107).

The board is a **controller**. `plot-fleet-scan.sh`, `plot-reconcile-scan.sh` and
`plot-impl-status.sh` are scripts reached from adapters. CLAUDE.md: *"A controller
calls the domain. It never spawns"*, and *"scripts can only be called from an
adapter implementation."* An index the board owns and scripts read inverts that
arrow — which is why the plan's own line 149 refuses HTTP and then declares the
question open.

The 15/15/7 call-site counts are correct (verified by grep on `plot-host.sh`).
The cost is real. But `PLOT_TERMINAL_CACHE` is **not** the precedent the plan
claims: it is not shared with anything. It is passed *into one scan* by
environment and reported back on stderr (`plot-fleet-scan.sh:1223`, `fleet.ts:3300`),
and each entry is validated against `TERMINAL_PLAN_OID` and `TERMINAL_MAIN_OID`
(`plot-fleet-scan.sh:1240-1243`) — keyed to one plan's blob. Nothing in it is
legible to `plot-reconcile-scan.sh` or the supervisor. It is a one-consumer
handoff, and the plan cites it as a multi-consumer store.

A deliberately unspecified slice that crosses three scripts, the supervisor and a
settled layering rule is not a slice. It is a second plan.

## Against reject

The host-cost problem in slice 3 is genuine and unsolved, and the plan states it
well. `entry.shrink` reporting rather than reaping may be the wrong call. Neither
survives inside this plan: the first is a separate design with its own layering
argument to win, and the second is a one-line change to an existing rule, not a
new index.

## What a replacement must say

- Which payload, at which timestamp, omitted a row a complete payload had — the
  composition at `:3242` means that needs showing, not asserting.
- Whether the two missing rows rendered under `[data-unplaced]`.
- Why `sectionKey` is not the key.
- What `entry.shrink` should do differently, if removal is wanted.
- The client-side action-result write (slice 2) is the one part with no
  predecessor and no contradiction found. It is a small, self-contained plan and
  would stand alone.
