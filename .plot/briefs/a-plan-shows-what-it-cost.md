## Implementation brief — a-plan-shows-what-it-cost (slice: A plan shows what it cost)

- **Plan (canonical):** `docs/plans/2026-09-15-a-plan-shows-what-it-cost.md` on `main`
- **Story:** `plot-plan-economics`
- **Sprint:** `a-declared-agent-costs-what-it-costs`
- **Approved:** 2026-09-16, jwloka, in-session — after **1** round, plus a three-lens panel
- **Branch:** `feature/a-plan-shows-what-it-cost` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

The plan's only slice. **It waited on `a-plan-states-what-its-slices-cost`, and that wait has cleared** — the rollup merged as PR #919 and the plan is Delivered. Verified on `origin/main` 2026-09-16: `packages/domain/src/rules/plan-spend.ts` and `readPlanSpend` both exist. Nothing else waits on this branch.

## The measurement

**`planSpend` ships with exactly one caller, and it is in the same package.** Re-measured on `origin/main` 2026-09-16 across `packages/`, `skills/` and `scripts/`, excluding tests and generated bundles:

```
packages/domain/src/workflows/slice-spend.ts:132   return planSpend(...)   ← the only one
```

`planSpendSummary` has **zero** callers anywhere. So the rollup computes a plan's cost correctly and no human being can see it — *"the only reader is a test"*, and that is the third time this shape has shipped on this story. This branch is what makes it two readers, one of them a person.

## The destination is verified, hop by hop

**A rejected sibling on this story, `the-deploy-job-shows-on-main`, asked to render onto a row that did not exist.** Two of its hops were negatively verified. Every hop here was positively verified on `origin/main` 2026-09-16 — the line numbers below are current, not inherited from the plan:

| hop | where | state |
|---|---|---|
| `CardSchema` | `packages/board/src/contract/schema.ts:357` | exists; `rounds` optional field at `:384` |
| reading site | `packages/board/src/server/board.ts:973` (`planStatus`) | exists; called `:1930` |
| per-plan loop | `board.ts:1896` — `for (const meta of metas)` | exists |
| `rounds` attach | `board.ts:1973` — `if (meta.rounds !== undefined)` | exists; **this is the precedent** |
| render | `packages/board/src/app/components/PlanCard.tsx` | exists |
| render sites | `Board.tsx:253`, `Swimlanes.tsx:225` | **both**, and both are in scope |
| rollup | `packages/domain/src/workflows/slice-spend.ts:127` (`readPlanSpend`) | exists |

**Do not re-verify these before starting.** They were checked at dispatch. Verify only what you change.

## THE HOIST IS THE ONE GATE THE SLICE'S OWN WORDING WOULD FAIL

The slice line says *"take the reading in `board.ts` beside `planStatus`"*. **Read literally, that is a defect, and the plan's `Done when` catches its own Design's wording.** Do not resolve the contradiction in favour of the Design sentence.

`planStatus` is called at `board.ts:1930`, **inside** `for (const meta of metas)` at `:1896`. The adapter does not save you:

```
packages/domain/src/adapters/slice-spend/slice-spend-file.ts:88   let cached          ← the DIRECTORY
packages/domain/src/adapters/slice-spend/slice-spend-file.ts:201  lines: async () =>  ← readFile, EVERY call
packages/domain/src/adapters/slice-spend/slice-spend-file.ts:205  await readFile(path, 'utf8')
```

**`cached` holds the resolved directory path, never the file contents.** So `lines()` opens the record on every single invocation, and a reading placed beside `planStatus` is **one `readFile` per plan per board refresh** — roughly 290 plans on this estate, on a board that refreshes every few seconds.

**Hoist the read ABOVE the loop.** Read the record once, then partition per plan. `readPlanSpend` re-reads the file per call by design, so calling it N times is the same defect wearing a helper's name — the shape that works is one `lines()` call whose result feeds `planSpend(lines, branches)` per plan, which is a **pure function** and reaches nothing.

**The gate is a counting stub asserting `lines()` is called once per board build.** Not a returned value — a returned value is identical whether you read once or 290 times, which is exactly why this is pinned by call count. `SliceSpendRecord` is an interface (`packages/domain/src/ports/slice-spend.ts:34`), so the stub needs no filesystem.

## THE CARD LEADS WITH COVERAGE, NOT THE COUNTERS

**The operator settled this shape, and the panel found the earlier draft had lost it.** The rollup refuses a bare total in the data; an earlier draft inherited that refusal in the data and dropped it in the render.

Measured over a real plan, the four counters span **five orders of magnitude**:

```
in 502 · out 107,182 · cache-write 528,331 · cache-read 40,690,450
```

**The largest is 81,000× the smallest, so a two-second reader reads the big one** — the cache-read count, which `plan-spend.ts:36` names *"a cache-read count wearing a cost's name"*. **Not summing is not the same as not being read as a sum.** A key-set assertion gates the arithmetic and gates nothing about what the eye does.

So the glance-level text is coverage:

```
measured on 3 of 5 slices        ← the card
not measured here (2 absent)     ← when tokens is null
```

**The counters stay reachable without leaving the board** — hover or the plan modal — and that is pinned separately, so the refusal to show them at a glance is not a refusal to show them. `planSpendSummary` (`plan-spend.ts:127`) already composes the full sentence and already refuses a number where nothing was measured; use its coverage clause and defer the counters.

## The rules carried over unchanged — do not re-derive them

**Absent is not zero, at every level.** `planSpend` returns `tokens: null` rather than a zeroed record, because *"`reduce(…, 0)` over nothing is correct arithmetic and a lie"* (`plan-spend.ts:111-112`). A plan with nothing measured shows **no cost at all, never a zero**. `noTokens()` is the identity a sum starts from and never an answer.

**`absent` and `unreadable` are two counts and never one.** A branch nobody measured here and a record that could not be read are different facts; collapsing them is *"the failure this repo has shipped twice"* (`plan-spend.ts:25-28`).

**No fifth summed figure.** `TokenCountsRecord` is four keys. Cache reads are 99.36% of a naive four-counter total. Pin this with a **key-set assertion on the Card**, not by reading the DOM — a DOM test passes while a summed field sits unrendered in the payload.

**`!== undefined`, never truthiness.** Follow `board.ts:1973` exactly. A measured zero is a real answer, and `if (card.cost)` discards it. `roundsBadgeText` (`PlanCard.tsx:142-145`) is the render-side twin: it returns `''` on `undefined` and renders `1 round` for the value 1 — it never treats 0 and absent alike.

**The reading is taken in `board.ts`; the decision stays in the domain.** `planStatus`'s own comment states the split: *"THE READINGS ARE TAKEN HERE, THE DECISION IS NOT… that split is why the rule is testable without a `FleetReading`."*

**The sum is biased LOW and that is a known property, not a bug to fix here.** A worker killed by the `Worker bound` never reaches the write site, so the most expensive runs record nothing (`plan-spend.ts:70-73`). Do not add a correction.

## Where to put the display logic

**Export a pure function from `PlanCard.tsx` and test it without a browser.** Both neighbours do exactly this and both were written for the same reason:

- `roundsBadgeText(card)` — `PlanCard.tsx:142`, rendered `:328` inside a `<Badge variant="neutral">`
- `sliceBadgeText(s)` — same file, whose docstring gives the reason: *"this is display logic with real edge cases… and an empty badge on screen is exactly the kind of thing prose promises and code forgets"*

This also satisfies the repo's standing rule that **every rendered state is a domain property** — a view state that cannot be asserted without a browser is one that has not been extracted yet. The browser test then proves the badge *shows* what the unit test proved it *says*.

## Done when

The plan's `## Done when` list is the specification — read it in the plan, it is canonical. The assertions below exist **because a naive implementation passes without them**:

| assertion | what it catches |
|---|---|
| `lines()` called **once per board build**, via counting stub | the literal "beside `planStatus`" reading — 290 `readFile`s per refresh, invisible in every returned value |
| rendered text contains **no counter value** | a card that technically "shows the cost" by printing 40,690,450 |
| the four counters **reachable without leaving the board**, pinned separately | over-correcting into hiding the data entirely |
| **key-set assertion on the Card**, not the DOM | a fifth summed field present in the payload but unrendered |
| a plan with nothing measured shows **no cost, never a zero** | `reduce(…, 0)` reporting an unmeasured plan as free |
| unmeasured plan shows **counts beside the sum** | a bare total, which is the misreading the rollup refuses |
| field **optional**; a payload without it renders **exactly as today** | every existing board being disturbed |
| **both** render sites — `Board.tsx` and `Swimlanes.tsx` | a field on one board view and not the other |
| no render path opens a record file | per-refresh file I/O sneaking back in at the render layer |

Plus the repo's gates: `pnpm run test:contracts`, `pnpm run typecheck`, and the board suite (`pnpm run test:board`). **Run `nvm use` first** — Node 24 per `.nvmrc`; pnpm crashes outright on Node 26 and a background job under it exits silently having produced nothing.

**`pnpm run test:e2e` is CI's gate, not yours.** Do not run it. It dispatches real workers into sandbox repos and has taken this machine down.

**Add a changeset.** This touches `packages/board` and `packages/domain`, no skills — so `'@plot-pm/board': patch` in the frontmatter and **no `bumps:` block**. Description FIRST, `plan:` line inside the trailing comment:

```
plan: docs/plans/2026-09-15-a-plan-shows-what-it-cost.md
```

A `bumps:`/`plan:` line written first becomes the published release note and the real description never ships — `./scripts/check-changeset-packages.sh` refuses that.

## Bookkeeping

**Open the PR through the controller:**

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while the work moves
```

It takes the title from the plan's wave heading. **Do not run `gh pr create`** — measured 2026-09-08, three slice PRs opened that way each took their title from the last commit subject, which on this estate is routinely `plot: build the board artifact`.

**When the PR exists, append `→ #<number>`** to this branch's line in the plan's `## Slices` section. `/plot-deliver` back-fills a missed one, but written-at-creation keeps the plan current.

**Push the first real commit as soon as it exists.** A branch with unpushed work reads as `eligible` to the fleet scan, which derives from `origin/<branch>` — two implemented, green branches were lost to exactly this.

**Rebuild the board artifact** (`pnpm build:board`) and commit it; CI has a no-diff gate. On a conflict in `board-server.mjs`, do **not** read the diff — it is generated output marked `-merge`. Take either side, rebuild, commit.

## Scope guard

**This branch owns:**

- `packages/board/src/contract/schema.ts` — the one optional `CardSchema` field
- `packages/board/src/server/board.ts` — the hoisted reading and the attach
- `packages/board/src/app/components/PlanCard.tsx` — the badge text function and its render
- the board's tests for the above, and one changeset

**Verified at dispatch, not guessed: no sibling implementation branches are in flight.** `git for-each-ref refs/remotes/origin` on 2026-09-16 shows only `main` and `changeset-release/main`. The estate is quiet and this branch owns its files uncontested.

**Do not touch** `packages/domain/src/rules/plan-spend.ts` or `workflows/slice-spend.ts`. The rollup landed yesterday with its own gates; this branch is its consumer, not its second author. If the rollup's shape genuinely does not fit the render, that is a finding to report — not an edit to make here.

**The plan invites its own removal, and that stands.** `CardSchema:381` and `PlanCard:126` both say *"a number nobody acts on is the crowding this board keeps removing"*, and the plan answers that a coverage line is a data-quality signal rather than a number to act on. Its words: *"If that distinction does not survive contact with the rendered card, this field should be removed rather than defended."* **Report that if you see it. Do not quietly widen the field to justify it.**

One open question, explicitly non-blocking: whether an unmeasured plan shows **nothing** or a muted *"not measured here"*. Either satisfies the no-zero rule and the render is one line apart. Pick one and say which in the PR.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
