# Board lens — a-plan-shows-what-it-cost

Read against `origin/main` at `dfd585455` (local `530e57dd1`).

## 1. Every factual claim, checked

Four claims, all TRUE, one with a line-number slip.

**`CardSchema` carries four optional fields.** TRUE, and it understates. `packages/board/src/contract/schema.ts:358` opens `CardSchema` (the plan says `:357`, which is `export type PlanStatus`; off by one, harmless). The optional fields are `sprint:362`, `story:363`, `assignee:364`, `started:370`, **`rounds:385`**, plus `sliceSummary`, `worktrees` and `hasDispatchLog` further down — so **eight or more**, not four. An optional fifth is not merely "understood work"; it is the dominant shape of this schema.

**`PlanCard.tsx` exists and renders card-level facts.** TRUE. `packages/board/src/app/components/PlanCard.tsx`, 429 lines, imported by `Board.tsx:6` (rendered `:253`) and `Swimlanes.tsx:6` (rendered `:225`). It exports `sliceBadgeText` (`:113`) and `roundsBadgeText`, both reused by `app/lib/agent-rows/rows.tsx:23`. **Both live render sites are real** — this is the fact the rejected sibling could not produce.

**`planStatus` at `board.ts:973` says what the plan quotes.** TRUE and verbatim. `packages/board/src/server/board.ts:973` is the docstring; `:975-977` reads *"THE READINGS ARE TAKEN HERE, THE DECISION IS NOT. `planStatus` in `packages/domain/src/rules/phase.ts` takes values and returns a status; this runs the two pulse queries it needs and hands them over."* The function is `:973-985`. The quotation is accurate.

**Unverified in the plan, and it matters more than the above:** the plan never names `packages/board/src/server/entry/slice-spend.ts`, which already exists on main and is the board package's own reader of this record. That omission understates the plan's case — see §2.

## 2. The render path, hop by hop — every hop is real

| hop | what exists on main | verdict |
|---|---|---|
| the rule | `packages/domain/src/rules/plan-spend.ts` — `planSpend(lines, branches) → PlanSpend` with `tokens \| null`, `measured`, `absent`, `unreadable`, `slices`; plus `planSpendSummary` | **shipped** |
| the reading | `SliceSpendRecord.lines(): Promise<PortResult<readonly string[]>>` — `packages/domain/src/ports/slice-spend.ts:80`. **Exactly the shape `planSpend` takes**: raw lines, whole file, one call, not per branch | **shipped, and shaped for this caller** |
| the adapter | `sliceSpendFile()` — `packages/domain/src/adapters/slice-spend/slice-spend-file.ts:79`, exported from `adapters/index.ts:53`. Resolves from `--git-common-dir`, so the main checkout and every desk share one file | **shipped and exported** |
| board can import it | `board.ts:46-53` already imports `{buildShell, hostShell, planStoreShell, refsGit, scriptsShell, treesGit}` from `@plot-pm/domain/adapters`. Adding `sliceSpendFile` is one identifier in an existing import list | **precedent in the same statement** |
| board can await it | `buildBoard` is `export async function … : Promise<Board>` (`board.ts:1727`). The card loop at `:1895` sits inside it | **async already** |
| the branches | `meta.slices` is already read at `:1993` for `sliceSummary`. `planSpend`'s second argument is the branch list the plan names | **already in hand** |
| the field | `card.rounds` at `board.ts:1973`, conditional on `!== undefined` — the exact no-zero discipline this plan needs, already written | **the template** |
| the render | `PlanCard.tsx` `sliceBadgeText` (`:113`) is a badge built from an optional summary object with counts, with an explicit *"absent means unknown, never zero"* rule (`:105-110`) | **the template, again** |
| the client | `App.tsx:241` **CASTS** (`as Board`), does not parse. Noted below as the one real trap | **works, with a caveat** |

**No hop is missing.** Contrast the rejected sibling, where two hops were *negatively* verified: `board.ts:705-707` and `fleet.ts:1243` filtered the destination out, and `build` was a `RowKind` with no producer. Nothing here is filtered out and nothing is producer-less.

**The one hop the plan under-specifies:** `lines()` must be called **once per board build**, not once per card. `planSpend` takes lines as a value precisely so it can be. The plan says "read once per board build" in `Done when` but places the reading "in `board.ts` beside `planStatus`" — and `planStatus` is called **inside** the `for (const meta of metas)` loop (`:1969`). Read literally, that instruction puts an `await lines()` inside the per-plan loop. The adapter caches only its *directory*, not the file contents (`slice-spend-file.ts:84-102` caches `dirOf`, nothing else), so a literal reading is N file reads per refresh. The hoist is one line above the loop and the plan's own gate would catch it — but the instruction and the gate currently point in opposite directions.

## 3. Is the destination genuinely different? Yes — and the difference is measurable

**What exists:** the rule, the port method matched to the rule's signature, the adapter, the adapter export, the import statement to extend, an async build function, the branch list, a conditional-attach precedent five lines from where the code goes, and a badge-rendering precedent in the destination component. Nine of ten hops are already built.

**What must be built:** one schema field with a docstring, one `await` + one conditional attach in `board.ts`, one badge function + one render line in `PlanCard.tsx`, and tests. That is the whole delta.

**The sibling panel's "six touchpoints" figure does not transfer, and here is why.** That count is for a board **capability** — my recalled measurement of one (`board.reslice`) lists schema, `board.ts` placeholder, `index.ts`, App guard, `AgentList` props + 2 call sites, control + menu. A capability is a *flag that gates an action*, so it must reach the action plumbing. An **optional Card display field is a different animal**, and the estate has a measured precedent: commit `4c7e3cab7`, *"a Draft card wears its interrogation round"*, which added `rounds` — the closest possible analogue, also optional, also no-zero, also card-only:

```
packages/board/src/app/components/PlanCard.tsx     |  36 ++
packages/board/src/contract/schema.ts              |  29 ++
packages/board/src/server/board.ts                 |   5 +
packages/board/test/board.test.mjs                 |  97 ++
packages/board/test/unit/rounds-badge.test.ts      |  69 ++
packages/board/test/unit/schema.test.ts            |  28 ++
skills/plot/scripts/board/board-server.mjs         | 102 +- (generated artifact)
```

**Three source files, five lines in `board.ts`, plus tests and the rebuilt artifact.** The plan's estimate — *"one `CardSchema` field, one reading in `board.ts`, one render in `PlanCard`"* — is the measured shape of its own nearest precedent. This plan adds one `await` that `rounds` did not need. **The estimate holds.**

**The trap the plan does not name.** `App.tsx:241` casts rather than parses (`as Board`), and `sections.ts:286` calls this out as *"THE CAST GUARD"*. Zod `.optional()` is safe under a cast — `undefined` is the honest value — so this field is fine, unlike a `.default()`. But it means **the client gets no runtime validation**, so a server that omits the field and a client that mis-reads it look identical. The plan's *"a payload without it renders exactly as today"* gate covers this if the test drives the real client path; it does not if the test only asserts on the schema.

## 4. What `Done when` fails to pin

The `Done when` is unusually strong — six separate gates, several of them mechanism-specific (a counting stub, a key-set assertion). It closes the sibling's exact failure mode: *"pinned by a browser test"* appears on the first gate, so a passing suite with nothing on screen is not reachable the way it was for the deploy plan.

Three gaps remain, in descending severity:

**(a) No gate pins that the file is read ONCE, only that no *render* path opens it.** The gate is *"the cost is read once per board build and no render path opens a record file — pinned by a counting stub asserting zero calls"*. **Zero calls from the render path** and **one call per board build** are different assertions, and only the first is pinned. An implementation that calls `lines()` inside the `for (const meta of metas)` loop — which is what *"beside `planStatus`"* literally instructs — passes the zero-calls-from-render stub while doing N reads per refresh on an estate with 250+ plans. This is the plan's most likely real failure, and it is a performance regression the board has been bitten by before.

**(b) "Renders nothing a user sees" is pinned for three cases and not the fourth.** Measured, unmeasured-with-counts, and nothing-measured are each pinned by a test. **A plan with no slices at all is not** — `planSpend(lines, [])` returns `tokens: null, measured: 0, absent: 0, unreadable: 0, slices: []`, and `planSpendSummary` renders `not measured here (no slices)`. Whether the card should say that about a pre-slice plan is exactly the Open Question, left open. Most of this estate's Discovery cards have no slices, so the untested case is the common one.

**(c) The browser test's subject is not pinned to the live render sites.** `PlanCard` is reached from `Board.tsx:253` **and** `Swimlanes.tsx:225`. A browser test that exercises only the default Board view leaves the Swimlanes path unasserted. This is a smaller version of the sibling's disease — a component that renders in one view and not the one the user is looking at. My own recalled experience on this board: *"Plan head renders only when planHeads is true"*, and *"Board renders the checked-out branch"*. Fixture-shape traps on this board are routine.

None of (a)–(c) reproduces the sibling's failure — *every gate green, nothing on screen*. They are narrower: a perf regression, an untested common case, and a half-covered view.

## 5. Strongest argument against doing this at all

**Nobody acts on it, and the board's stated design principle is to remove exactly that.**

The plan says so itself: *"It does not decide anything. No gate, no delivery check, no dispatch input reads a cost. It is shown."* Set that against `CardSchema:378-383`, the estate's own rule for what a card may carry: *"a design-time count to all of them would be the crowding this board keeps removing"* — and `PlanCard:99`, *"a number nobody acts on is the crowding this board keeps removing."* **This plan proposes exactly the thing two comments in its own destination file name as the thing to remove.** `rounds` survived that test by being Draft-only and gating an interrogation decision; a token sum gates nothing at any phase.

Second, **the number it shows is knowingly wrong in a direction the reader cannot see.** `plan-spend.ts:70-74` states it: *"a worker killed by the `Worker bound` never reaches the write site, so the most expensive runs record nothing and the sum is biased LOW."* And 64 of 68 desks are reaped. So the card would show a low-biased sum, qualified by counts most readers will not weigh, about a quantity nobody spends.

**Why this does not reach reject.** The counter is that `planSpend` and `planSpendSummary` shipped with **no consumer outside the domain** — the condition the `consumer` lens flagged on the predecessor, and which this plan exists to close. Leaving them consumer-less is itself a defect this repo has named twice. And the plan's refusals are unusually disciplined: no fifth summed figure, no price table, no cross-machine aggregation, no branch-row render, counts always travelling with the sum. If a cost is going to be shown at all, this is the right shape for it. The crowding argument is a real cost to weigh, not a disproof — and it is the plan's weakest flank, which is worth saying out loud to whoever approves it.

## What I would change

1. **Fix the reading's placement.** Replace *"take the reading in `board.ts` beside `planStatus`"* with *"take the reading ONCE, before the `for (const meta of metas)` loop at `:1895`, and pass the lines into the loop"* — `planStatus` is called inside that loop, so *beside it* is the wrong instruction for a per-build read.
2. **Add a gate for exactly one call.** *"`lines()` is called once per board build regardless of plan count — pinned by a counting stub over a two-plan fixture asserting exactly 1."* The existing zero-calls-from-render stub does not cover it.
3. **Pin the no-slices case**, or state in the Open Question that a plan with no slices renders nothing. It is the common case on this estate.
4. **Name the render site in the browser gate** — `Board.tsx:253`, and say whether `Swimlanes.tsx:225` is in scope.
5. **Correct `:357` to `:358`**, and say "five or more optional fields" rather than four — the claim is stronger than the plan makes it.

All five are amendments to the `Done when` and one sentence of the slice. None changes the shape, the scope or the destination.

Verdict: amend
