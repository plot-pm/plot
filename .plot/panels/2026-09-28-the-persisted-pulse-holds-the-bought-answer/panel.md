# Panel — the persisted pulse holds the bought answer (#1050)

Subject: `docs/plans/2026-09-28-the-persisted-pulse-holds-the-bought-answer.md`
Round 1, 2026-09-28. One juror, both commitments gated.

| Juror | Position | Evidence |
|---|---|---|
| evidence | **reject** | executed |

**REJECT. The feature is already on `main`, shipped 2026-09-22, six days before the issue was filed.**

## The finding

`seedPrsFromStore` (`packages/board/src/server/fleet.ts:2629`) reads the PR store into the entry's maps when the process holds nothing, and it is called on the refresh path at **`:2829`, before the host call**. The call that follows is already a delta — a second `prStore.read` feeds `prWindowFor(stored, Date.now(), PR_FULL_READ_MS)`, appending `--since` from the store's watermark (`:2841-2848`).

Its own docstring states the plan's goal almost verbatim:

> **THIS IS WHAT A RESTART BUYS … a process that has just started renders the last answer immediately and replaces it when the host speaks.**

Built by `83c4abdc` *"refreshPrs reads the store before its call and writes it after"* and `09cf9018` *"the call asks only for the delta"*, both **2026-09-22**. Issue #1050 was filed **2026-09-28T20:26Z**.

## Verified independently by the moderator

| claim | check |
|---|---|
| `seedPrsFromStore` exists and is called pre-host | `fleet.ts:2629`, called `:2829` |
| two commits built it | `83c4abdc` 2026-09-22 08:14, `09cf9018` 2026-09-22 10:55 |
| store version matches code | store `v: 2`, `PR_INDEX_VERSION = 2` |
| store is populated | **988 rows, `complete: true`**, written 21:01 today |

The juror measured `complete: false` and named it the one loose thread; eight minutes later it read `complete: true`. That thread has closed too.

## Every supporting measurement in the plan is false

1. **The `v: 1` hypothesis is dead.** The plan's Notes call it *"may be the whole defect"* and *"may make this cheaper than it looks"*. The live store is `v: 2` against a code constant of `2`. Nothing falls through for version reasons.
2. **The pulse measurement is misquoted.** The plan says 11 KB and lists keys `main head read_ref local_head plans summary` — those are the **nested `pulse` object's** keys, not the file's. The file is 16 099 bytes with top-level `ages approvedAt at branchUrlBase ideaPlans pulse version`.
3. **The Done-when list describes an existing green test file.** `packages/board/test/unit/pr-store.test.ts` — 29 tests, all passing under Node 24 — already asserts each acceptance criterion: `:368` fills maps from disk before the host answers; `:350` an unrecognised version falls back; `:333` an unreadable store leaves the board working; `:218`/`:233` a partial pass never reads as *no PR*; `:380` the seed does not stamp `prAt`.

## Why it survived being written

**The plan's Design section is persuasive because it describes `main` accurately.** The author read the write path (`fleet.ts:2740`) and inferred there was no read path — 90 lines away in the same file. The plan even concedes the store exists and is written by `fleet.ts`, then says *"this plan does not add a store, it makes the restart path read it"*. The restart path already reads it.

This is `measure-the-mechanism-not-only-the-symptom` exactly: symptom measured correctly, mechanism inferred without opening the file.

## The three-way deferral was not diligence

The plan defers its cause to the slice — *"the slice measures before changing anything"*. All three candidates are answerable by reading one file, in under ten minutes: cause 1 is false at `:2829`, cause 2 is false at 988 rows written today, cause 3 is false at `v: 2 == 2`. The deferral is what let a dead hypothesis survive into a Draft.

## On the stated reason the pulse persists only git

The plan reads `fleet.ts:2173` correctly — *"A persisted verdict would be a cache git cannot reach"* — and then misapplies it. That line refuses to persist a **verdict**, not an answer. The pulse and the PR index are **two stores with two jobs**; PR answers are persisted, just not in `last-pulse.json`. There is no inversion to fix, and CLAUDE.md's `a-decision-reads-the-index` requires the persistence the plan asks for.

## Disposition

- **Plan → Rejected.** No slice, nothing to amend into.
- **Issue #1050 → rephrased, not closed.** Its measurement of `last-pulse.json` is correct; its conclusion is not. The surviving question is narrow: the seed is a *render* optimisation and does not reduce the host call, which is still `--state all --limit 1000`. Whether the store could make the call itself cheaper is a different question with a different subject.
