# Consequence lens — work-given-up-is-not-work-never-done

Position: amend

## 1. Who calls `allSlicesMerged`?

Four call sites, in two packages. The rule itself is `packages/domain/src/rules/deliverable.ts:62`, re-exported through `packages/board/src/server/board.ts:930`.

| # | Caller | What it does with the answer | After the change, for an all-deferred plan |
|---|---|---|---|
| 1 | `board.ts:1004` — `planStatus` → `decidePlanStatus` (`domain/rules/phase.ts:157`) | `landed === 'merged'` ⇒ `status: 'deliverable'` | status flips `approved`/`in-progress` → **`deliverable`** |
| 2 | `board.ts:1978-1979` — `buildBoard` card walk | `deliverable` sets `card.deliverable = true` AND **rewrites the card's column**: `phase = deliverable ? toBoardPhase('delivered') : mapped` | card **jumps from Development into Testing**, and gains the Deliver control |
| 3 | `deliver.ts:230` — `deliverability()`, behind `POST /api/deliver` | `'merged'` ⇒ `verdict: 'deliverable'`; anything else refuses | the route stops refusing — this is the plan's stated goal |
| 4 | `auto-deliver.ts:237` (`planAutoDeliver`) and `:271` (`pruneDelivering`) | `!== 'merged'` ⇒ `continue` | **the plan is auto-delivered, unattended** |

Two further consumers ride on #1 without naming the rule: `fleet.ts:7370` and `fleet.ts:7444` bucket `'deliverable'` into a sprint's **`wip`** count. An all-deferred sprint member currently counts `open` (via `approved`) and would move to `wip` — a shelved plan reported as work in progress. Small, but it is a third reader the plan does not mention.

## 2. What acts automatically on it?

**`auto-deliver.ts` — and this is the finding.**

It is **unconditional**. `fleet.ts:3418` calls `maybeAutoDeliver(opts, complete, entry.deliverInFlight)` inside `refresh`'s success path on every landed scan. There is no config key, no settings flag, no cap — `maybeAutoDeliver`'s own docstring says so: *"There is no switch and no cap, which is a deliberate asymmetry with auto-dispatch rather than an omission."* Any board running against this repo delivers on the scan's clock.

So yes: **plans would be auto-delivered that are not today**, with no human in the loop. The chain that fires is deliver → reap → **`plot-release-refs.sh --yes <slug>`** (`auto-deliver.ts`, three chained exit listeners) — the last link deletes remote refs, which `CLAUDE.md` names as the one action that is not re-creatable at all.

**Newly qualifying on this estate — enumerated.** I parsed all 318 plan files with `plot-plan-meta.sh` and selected those whose every branch carries `deferred:`/`moved:`. Ten, matching the plan's own count exactly:

| phase | plan | auto-delivered after the change? |
|---|---|---|
| **approved** | `2026-09-22-a-failed-tick-must-not-end-the-daemon.md` | **YES** |
| **approved** | `2026-09-22-a-test-must-not-stop-the-fleet.md` | **YES** |
| rejected | `2026-08-31-the-board-answers-while-it-scans.md` | no — phase gate |
| released ×4 | `plot-sprint-support`, `the-page-is-as-tall-as-the-screen`, `a-merged-slice-has-no-ref-to-count`, `the-supervisor-says-why-it-handed-nothing` | no — phase gate |
| superseded ×3 | `a-free-agent-is-not-a-finished-one`, `a-panel-leaves-a-record`, `a-waiting-loop-has-not-finished` | no — phase gate |

**Two plans auto-deliver on the next scan tick.** `planAutoDeliver` filters `phase !== 'approved'`, so the other eight are safe.

One of the two the plan itself flags as not ready: note at line 109 says `a-failed-tick-must-not-end-the-daemon` *"owes three corrections of its own and is not merely blocked on this."* The plan names a plan that is not finished and its own change would deliver it automatically, without the person who owes those corrections being asked. That is the concrete harm, and it is in the plan's own Notes.

**Is it desirable or dangerous?** Dangerous as written, because of §5 below — the old behaviour here was a deliberate, argued, tested decision, not an oversight.

## 3. Does the board's card rendering change?

Yes, in three visible ways, all from `buildBoard`:

- **Column.** `board.ts:1979` — `phase = deliverable ? toBoardPhase('delivered') : mapped`. The card **moves out of Development into Testing** before anyone delivers it. An operator reads the Testing column as *work that landed*; an all-deferred plan landed nothing.
- **Deliver control.** `card.deliverable = true` (`board.ts:2094`) → `menus.tsx:1459` `canDeliver = Boolean(card?.deliverable && deliver)` → `DeliverButton` renders (its own docstring: *"rendered ONLY on a `deliverable` card"*). The operator is newly offered a Deliver button — though in practice auto-deliver reaches it first.
- **Sprint chips.** `fleet.ts:7370`/`:7444` move the member from `open` to `wip`.

The plan's *Board impact* line says the change gives such a plan its button. It does not mention the column bump or the sprint bucket. Both are consequences of the same bit.

## 4. Safe to land alone?

**No.** The rule change is one line; the behaviour it unlocks is unattended delivery plus ref deletion. Two things need to be true first, and neither is in the plan's `Done when`:

1. **`auto-deliver.ts` must keep its own refusal**, independent of `allSlicesMerged`. Its docstring names *"At least one branch actually merged"* as a distinct `Done when` item that *currently leans on* `allSlicesMerged`'s `merged > 0` guard. The plan removes that guard's effect and says *"Nothing else in the rule moves"* — true of the rule, false of the caller. `planAutoDeliver` must gain an explicit all-deferred check, or ITEM 5 dies silently.
2. **`packages/board/test/unit/auto-deliver.test.ts:218`** — `'ITEM 5: a plan whose remaining waves are ALL deferred is not delivered'` — **will fail**. That test is not incidental coverage; its file header lists ITEM 5 among the items that exist *"BECAUSE A NAIVE IMPLEMENTATION WOULD PASS WITHOUT THEM."* The plan's `Done when` does not name it. A branch that lands this and makes the suite green has either fixed the caller or deleted the assertion, and the plan gives no instruction on which.

The plan also asserts *"It does not touch `deliver.ts`'s own refusal at `workflows/deliver.ts:181`, which filters `!b.deferred && !b.merged`."* Verified — correct, and that is the rule `plot-deliver.sh` now actually asks (`plot-deliver.sh:165` shells to `board/plot-ask.mjs deliverable`, not to `allSlicesMerged`). The plan's framing of *"two readers"* is right, and it identifies the right one as wrong.

## 5. Is there a consumer for which the OLD behaviour was correct?

**Yes — and it makes this a trade, not a fix.**

`docs/plans/2026-08-27-a-finished-plan-delivers-and-clears-up.md` (State: **Released**) carries a section headed **"Not chosen: auto-deliver a plan with deferred waves"**:

> `allWavesMerged` already excludes them, and that is correct for the measurement — but a plan whose remaining work is *all* deferred has not finished, it has been shelved. **Delivering it would record a completion nobody decided.**
>
> So the trigger requires at least one merged wave and no unmerged non-deferred one. **A wholly-deferred plan stays for a person.**

Its `Done when` item 5: *"A plan whose remaining waves are all `deferred` is NOT auto-delivered. Shelved is not finished; that call stays with a person."*

So `merged > 0` is not the accident the plan describes. The plan says at line 53 *"Its comment names the case it catches: a plan whose slices are all `complete` over no branches at all"* — that is the comment's text, but a released plan rejected the all-deferred alternative **by name**, wrote it as `Done when` item 5, and locked it with a test. The guard serves two cases; the plan found one and argues the other away without knowing it was argued for.

That does not make the plan wrong. The controller/script disagreement is real and measured, and a person clicking Deliver on a shelved plan they judged finished is a legitimate act that `/api/deliver` refuses today. **But the fix as drafted grants the manual affordance and the unattended one with the same line**, and the unattended one was refused on the record.

## The amendment

Split the two consumers rather than the rule:

- Change `allSlicesMerged` as drafted — `/api/deliver`, the card, the button. That answers the measured defect.
- **Add an explicit all-deferred refusal to `planAutoDeliver`**, so ITEM 5 survives on its own terms instead of on a side effect. It already has the branches in hand; the test at `:218` then passes unchanged and keeps meaning what it says.
- Add to `Done when`: *`auto-deliver.test.ts` ITEM 5 passes unmodified*, and *neither approved all-deferred plan on this estate is auto-delivered by the change* — the second is checkable against the two slugs above.
- The corpus pair is the right instinct but is declared against the wrong shell reading: `plot-deliver.sh` stopped deciding (`plot-deliver.sh:131-165` — it asks `plot-ask.mjs deliverable`, which runs `workflows/deliver.ts`). The pair to declare is `allSlicesMerged` against **`deliver.ts`'s `!b.deferred && !b.merged`** — two TypeScript rules in one package that disagree — not domain against shell. The shell has no rule left to disagree with.

Without the second bullet this lands a silent regression on a released plan's named decision, and delivers two plans — one of which its own Notes call unfinished — before anyone looks at the board.
