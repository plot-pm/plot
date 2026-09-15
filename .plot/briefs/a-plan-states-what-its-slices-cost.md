# Implementation brief — a-plan-states-what-its-slices-cost

- **Plan (canonical):** `docs/plans/2026-09-15-a-plan-states-what-its-slices-cost.md` on `main`
- **Approved:** 2026-09-15, jwloka, in-session
- **Branch:** `feature/a-plan-states-what-its-slices-cost` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review, per repo convention

Sole slice of a one-wave plan. Nothing waits on it and it waits on nothing. Its dependency, `a-slice-says-what-it-spent`, merged as #918 and delivered 2026-09-15 — the inputs are facts on main rather than intentions.

## What to build

A slice records what it spent and **nothing adds them up**. `readSliceSpend` (`packages/domain/src/workflows/slice-spend.ts:102`) answers for one branch. Measured on main 2026-09-15 and re-confirmed during this preflight: no `planSpend`, no `spendForPlan`, no per-plan sum anywhere in `packages/domain/src` or `packages/board/src` — every match for *rollup* in the domain is a docstring anticipating this plan.

Build the rollup: given a plan's branches, sum each of the four token counters across the slices that were **measured**, and report the `absent` and `unreadable` counts beside the sum rather than folding them into it.

The plan is canonical and its Design section carries the full argument. This is orientation — **with one exception, immediately below, where a preflight measurement contradicts the plan's final gate.**

## READ THIS FIRST — the plan's last gate names a command that cannot run these tests

The plan's `Done when` closes with *"and `pnpm run test:contracts` passes."* **That command does not run the domain's tests.** Measured during this preflight:

```
package.json:19  "test:contracts": "... node --test ... test/reconcile/*.test.mjs"
packages/domain/package.json:21  "test": "vitest run"
```

`test:contracts` runs `node --test` over `test/reconcile/*.test.mjs` — the shell-helper contract tier. Every gate this plan describes is a **vitest** test under `packages/domain/test/`, reached by neither `test:contracts` nor `test:board` (which filters to `@plot-pm/board`). An implementer who ran only the named command would see green without executing a single test they wrote.

**The gate you must actually pass** is the one CI runs (`.github/workflows/ci.yml:844-846`):

```bash
pnpm --filter @plot-pm/domain exec vitest run --coverage
```

Run `pnpm run test:contracts` too — it is cheap and the plan asks for it — but it is not what proves this slice. **Do not "fix" the plan file to say so**: a plan is amended by its own lifecycle, not by an implementing branch. Note it in the PR body so the next reader sees it.

This is the same shape as the defect the plan's own Notes record in the delivered slice — a gate that self-certifies. Worth naming twice.

## The decisions the plan settles — do not re-derive them

**No combined fifth total, ever.** Cache reads are **99.36%** of a naive four-counter total, measured over three transcripts and reproduced by three jurors. A summed fifth field is a cache-read count wearing a cost's name. `TokenCountsSchema` (`entities/slice-spend.ts:14`) is `.strict()` with exactly four keys and its docstring states the key set **is** the contract. The rollup inherits this exactly: sum each counter across slices, write no total. Pin it with a key-set assertion, not prose — `slice-spend-file.test.ts:157,163` is the precedent, and it exists because a total appearing beside the four is a two-line change no review would flag.

**A plan with zero measured slices reports NO total, not zero.** This is `recorded zero is indistinguishable from a free run` applied one level up, and the plan says it is the property to pin first. `spendSummary` (`rules/slice-spend-record.ts:100`) already refuses to render a number for `absent`/`unreadable`; the per-plan answer inherits that refusal rather than re-deciding it.

**`absent` and `unreadable` stay apart and are never collapsed.** `SpendReadState` (`rules/slice-spend-record.ts:19`) is three-way on purpose. Its sibling `DeclarationReading`'s docstring states the rule: *"cannot answer is not no. This repo has twice shipped a collapse of those two."* Report two counts, not one. A fixture holding one of each is the gate.

**The rollup is sound because the gap is a cold start, not a property — and the panel's objection was real.** `.plot/panels/2026-09-15-a-slice-says-what-it-spent/panel.md` (`locality` lens) found that a sum over machine-local records is *structurally unsound*: reaped desks hold **92.12%** of output tokens and **91.94%** of cache reads, and a desk is reaped when its work **lands**, so absences correlate with success. What answers this is that `slice-spend-file.ts:63` resolves the record through `--git-common-dir`, so **a record survives its desk's reap** — the 64 reaped desks predate the record's existence. The rollup is complete going forward and empty backward. **Do not attempt a fix for the backward gap**; it closes itself.

**One absence is permanent and must be disclosed.** `seal_declaration` runs only after `run_bounded` returns 0, so a worker killed by the `Worker bound` never reaches the write site — **the most expensive runs record nothing**, and the bias runs LOW in a direction invisible from the records. The shipped code instructs its successor in exactly these terms (`workflows/slice-spend.ts:50-58`, `plot-worker-loop.sh:1074-1079`). Carry it into the gates; do not add a second write site to fix it.

**Branches come from the plan file, never from globbing the record.** A plan names its branches in `## Slices`; `plot-plan-meta.sh` reports them as `waves[].branches[]`. Ask for exactly those. A record whose branch no plan names is **not this plan's cost** — pin that a record naming an unlisted branch is ignored.

**Read the record once, not once per slice.** `readSliceSpend` calls `record.lines()` and then filters. Composing the rollup as N calls to `readSliceSpend` re-reads the whole file N times. The port hands back all lines; read once and partition. `readSpend` already takes lines as values, so this is a shape choice with no correctness cost.

**Lines as values — the domain touches no disk.** `readSpend`'s docstring: *"LINES AS VALUES, NEVER A PATH. The adapter decides what it read and this decides what it means."* The rollup is a pure function over lines plus a branch list. That is what makes the no-transcript gate cheap to assert.

**Carried-over invariants, so they are not re-learned by breaking them:**
- **Absent is not false; read the exit code, not the emptiness.** `lines()` answers `failed` for an unreadable record and `answered([])` for a missing one — a missing file is an **empty record**, not a failure. Only `failed` becomes `unreadable`.
- **It writes nothing.** A rollup is a read. Never append.
- **It gates nothing.** No delivery, release or dispatch consults a cost.
- **It renders nothing.** The render is a named follow-up plan, `a-plan-shows-what-it-cost`. This is the first half of a two-slice sequence, deliberately.

## Done when

The plan's `## Done when` list is the specification. Lifting the assertions that exist **because a naive implementation would pass without them**:

- **No combined fifth total, pinned by a key-set assertion.** Catches a helpful `total` field added beside the four — passes every value test, defeats the whole design.
- **A plan with zero measured slices reports no total rather than zero.** Catches the natural `reduce(…, 0)`, which is correct arithmetic and a lie.
- **A mixed plan reports the sum over `measured` plus `absent` and `unreadable` counts separately.** Fixture holds one of each. Catches the collapse this repo has shipped twice.
- **A record naming an unlisted branch is ignored.** Catches a rollup that globs the record instead of reading the plan's branches.
- **A plan whose record file is missing entirely reports every slice `absent` rather than failing.** Catches treating a cold start as an error.
- **No transcript is opened.** Same kind of test `readSliceSpend` claims to carry. **Note: that test does not exist** — the plan's Notes record this as a defect in the delivered slice, `slice-spend.ts:96` asserts a gate that was never written. Write a real one here; do not copy a claim.

Plus the repo's gates:

- `pnpm --filter @plot-pm/domain exec vitest run --coverage` — **the real gate**, see the warning above.
- **100% coverage on the pure side is a hard threshold**, not a report (`packages/domain/vitest.config.ts:66-72`: `src/!(adapters)/**/*.ts` and `src/*.ts` at 100 lines/branches/functions/statements). A new rule or workflow file with one unreached branch **fails CI**. Write no branch a test cannot enter — `readSpend:84` carries a comment explaining exactly this trap, where a guarded fallback became dead code appeasing `noUncheckedIndexedAccess`.
- `pnpm --filter @plot-pm/domain typecheck`
- `pnpm run test:contracts` — cheap, asked for by the plan, proves nothing here.
- **A changeset naming `'plot'`, not `@plot-pm/domain`.** `packages/domain` is `"private": true`, so Changesets does not publish it; the precedent for a domain-only change is the dependency's own changeset, which used `'plot': minor`. Put the description **first** and the `bumps:` block **last** — a `bumps:` block written first becomes the published release note, measured at 11% of entries before the gate existed. Add a `plan:` line inside that block, as the dependency did. `./scripts/check-changeset-packages.sh` refuses an unknown package and a description under 20 characters; note it derives valid names from the workspace, so it would *accept* `@plot-pm/domain` — the reason not to use it is the private flag, not that gate.
- **Arrow functions.** `export const f = (…) => …` in `packages/domain/`. The rule follows the diff: if you write the body, it is an arrow.
- **Factual TSDoc.** What it does, what the parameters mean, what it returns, how it fails. The reasoning goes in the plan and the commit message. Measured on the first rule moved into this package: 28 lines of code carrying 109 of comment, most of it argument. Do not repeat that here — this brief is where the argument lives.
- **Node 24.** `nvm use` before anything; pnpm crashes on Node 26. If `pnpm` misbehaves, use `corepack pnpm`.

## Bookkeeping

- **Open the PR through the controller**, from the branch:
  ```bash
  skills/plot/scripts/plot-open-pr.sh          # or --draft while work is moving
  ```
  It takes the title from the plan's wave heading and puts the plan and this brief in the body. **Do not run `gh pr create`** — measured 2026-09-08, three slice PRs opened that way each took their title from the last commit subject.
- **When the PR exists, append `→ #<number>`** to this branch's line in the plan's `## Slices` section, on `main`. Do it from a detached scratch worktree at `origin/main`; do not touch the shared main checkout.
- **Push the first real commit as soon as it exists.** An unpushed branch reads as `eligible` to the fleet scan, which is how two agents end up on one slice.
- Commit convention: `plot: <description>` — this is cross-cutting domain work, not a spoke change.

## Scope guard

**This branch owns** `packages/domain/src/` (the new rule or workflow and whatever it imports) and `packages/domain/test/`, plus one `.changeset/*.md`.

**It does not touch** `packages/board/`, `skills/plot/scripts/board/*.mjs`, or any skill prose. The plan scopes out rendering and bundling explicitly — no `CardSchema` field, no component, no new `.mjs` artifact. **That also keeps this diff clear of the board artifact entirely**, so the `-merge` conflict procedure never applies.

**Other branches in flight, verified at dispatch:** `bug/the-board-loop-reads-the-same-ceiling` — a board-loop change, no overlap with `packages/domain/src/` spend paths. `changeset-release/main` is the Changesets release PR and is not a slice. No collision predicted.

`.changeset/` holds other people's changesets — add yours, touch none.

If you find something the plan did not anticipate, report it rather than improvising outside scope. The `test:contracts` finding above is exactly that shape: named, not silently worked around.
